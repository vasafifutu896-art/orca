import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configureMultiInstanceProfile,
  formatMultiInstanceWindowTitle,
  MULTI_INSTANCE_SLOT_ARG_PREFIX
} from './multi-instance-profile'

const tempRoots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-multi-instance-'))
  tempRoots.push(root)
  return root
}

function fakeApp(baseUserDataPath: string): {
  app: { getPath: (name: string) => string; setPath: (name: string, value: string) => void }
  getUserDataPath: () => string
} {
  let userDataPath = baseUserDataPath
  return {
    app: {
      getPath: (name) => {
        if (name !== 'userData') {
          throw new Error(`Unexpected path: ${name}`)
        }
        return userDataPath
      },
      setPath: (name, value) => {
        if (name !== 'userData') {
          throw new Error(`Unexpected path: ${name}`)
        }
        userDataPath = value
      }
    },
    getUserDataPath: () => userDataPath
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('configureMultiInstanceProfile', () => {
  it('assigns the primary profile first and an isolated persistent slot next', async () => {
    const root = await makeRoot()
    const alive = new Set([101, 202])
    const firstApp = fakeApp(root)
    const firstArgv = ['orca']
    const first = configureMultiInstanceProfile({
      app: firstApp.app,
      argv: firstArgv,
      env: {},
      isDev: false,
      isServeMode: false,
      pid: 101,
      token: 'first',
      isProcessAlive: (pid) => alive.has(pid)
    })

    expect(first?.slot).toBe(1)
    expect(firstApp.getUserDataPath()).toBe(root)
    expect(firstArgv).toContain(`${MULTI_INSTANCE_SLOT_ARG_PREFIX}1`)

    const secondApp = fakeApp(root)
    const second = configureMultiInstanceProfile({
      app: secondApp.app,
      argv: ['orca'],
      env: {},
      isDev: false,
      isServeMode: false,
      pid: 202,
      token: 'second',
      isProcessAlive: (pid) => alive.has(pid)
    })

    expect(second?.slot).toBe(2)
    expect(secondApp.getUserDataPath()).toBe(join(root, 'instances', 'slot-2'))

    first?.release()
    alive.delete(101)
    const replacement = configureMultiInstanceProfile({
      app: fakeApp(root).app,
      argv: ['orca'],
      env: {},
      isDev: false,
      isServeMode: false,
      pid: 303,
      token: 'replacement',
      isProcessAlive: (pid) => alive.has(pid)
    })
    expect(replacement?.slot).toBe(1)

    replacement?.release()
    second?.release()
  })

  it('reclaims a stale PID lock', async () => {
    const root = await makeRoot()
    const lockRoot = join(root, 'instance-locks')
    mkdirSync(lockRoot, { recursive: true })
    writeFileSync(
      join(lockRoot, 'slot-1.json'),
      JSON.stringify({ pid: 999, token: 'stale', claimedAt: 1 })
    )

    const profile = configureMultiInstanceProfile({
      app: fakeApp(root).app,
      argv: ['orca'],
      env: {},
      isDev: false,
      isServeMode: false,
      pid: 404,
      token: 'fresh',
      isProcessAlive: () => false
    })

    expect(profile?.slot).toBe(1)
    expect(readFileSync(join(lockRoot, 'slot-1.json'), 'utf8')).toContain('"pid":404')
    profile?.release()
  })

  it('keeps an explicitly requested busy slot unclaimed until its owner exits', async () => {
    const root = await makeRoot()
    const lockRoot = join(root, 'instance-locks')
    const alive = new Set([101])
    mkdirSync(lockRoot, { recursive: true })
    writeFileSync(
      join(lockRoot, 'slot-2.json'),
      JSON.stringify({ pid: 101, token: 'owner', claimedAt: Date.now() })
    )
    const app = fakeApp(root)
    const profile = configureMultiInstanceProfile({
      app: app.app,
      argv: ['orca', `${MULTI_INSTANCE_SLOT_ARG_PREFIX}2`],
      env: {},
      isDev: false,
      isServeMode: false,
      pid: 202,
      token: 'replacement',
      isProcessAlive: (pid) => alive.has(pid)
    })

    expect(profile?.slot).toBe(2)
    expect(app.getUserDataPath()).toBe(join(root, 'instances', 'slot-2'))
    expect(profile?.ensureClaimed()).toBe(false)
    alive.delete(101)
    expect(profile?.ensureClaimed()).toBe(true)
    profile?.release()
  })

  it('seeds settings and SSH targets without copying project or terminal state', async () => {
    const root = await makeRoot()
    writeFileSync(
      join(root, 'orca-data.json'),
      JSON.stringify({
        settings: { theme: 'dark' },
        sshTargets: [{ id: 'ssh-1', label: 'Build box' }],
        repos: [{ id: 'repo-1' }],
        workspaceSession: { tabs: ['terminal-1'] }
      })
    )
    mkdirSync(join(root, 'instance-locks'), { recursive: true })
    writeFileSync(
      join(root, 'instance-locks', 'slot-1.json'),
      JSON.stringify({ pid: 101, token: 'primary', claimedAt: Date.now() })
    )

    const profile = configureMultiInstanceProfile({
      app: fakeApp(root).app,
      argv: ['orca'],
      env: {},
      isDev: false,
      isServeMode: false,
      pid: 202,
      token: 'secondary',
      isProcessAlive: (pid) => pid === 101 || pid === 202
    })
    const seededFile = join(root, 'instances', 'slot-2', 'orca-data.json')
    expect(existsSync(seededFile)).toBe(true)
    const seeded = JSON.parse(readFileSync(seededFile, 'utf8')) as Record<string, unknown>
    expect(seeded.settings).toEqual({ theme: 'dark' })
    expect(seeded.sshTargets).toEqual([{ id: 'ssh-1', label: 'Build box' }])
    expect(seeded).not.toHaveProperty('repos')
    expect(seeded).not.toHaveProperty('workspaceSession')
    profile?.release()
  })

  it('keeps development, serve, and disabled launches on the existing path', async () => {
    const root = await makeRoot()
    for (const options of [
      { isDev: true, isServeMode: false, env: {} },
      { isDev: false, isServeMode: true, env: {} },
      { isDev: false, isServeMode: false, env: { ORCA_DISABLE_MULTI_INSTANCE: '1' } }
    ]) {
      expect(
        configureMultiInstanceProfile({
          app: fakeApp(root).app,
          argv: ['orca'],
          pid: 1,
          ...options
        })
      ).toBeNull()
    }
  })
})

describe('formatMultiInstanceWindowTitle', () => {
  it('labels secondary windows while leaving the primary title unchanged', () => {
    expect(formatMultiInstanceWindowTitle('Orca', 1)).toBe('Orca')
    expect(formatMultiInstanceWindowTitle('Orca', 3)).toBe('Orca · 3')
  })
})
