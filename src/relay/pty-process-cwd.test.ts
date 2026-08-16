import { describe, expect, it, vi } from 'vitest'
import {
  capturePtyProcessIdentity,
  inspectPtyForegroundProcess,
  parseLinuxProcessStat,
  resolvePtyProcessCwd
} from './pty-process-cwd'

type StatInput = {
  pid: number
  pgrp: number
  session: number
  ttyNr: number
  tpgid: number
  startTime: string
  command?: string
}

function statLine(input: StatInput): string {
  const fields = [
    'S',
    '1',
    String(input.pgrp),
    String(input.session),
    String(input.ttyNr),
    String(input.tpgid),
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '20',
    '0',
    '1',
    '0',
    '0',
    input.startTime
  ]
  return `${input.pid} (${input.command ?? 'bash'}) ${fields.join(' ')}`
}

function stat(input: StatInput) {
  const parsed = parseLinuxProcessStat(statLine(input))
  if (!parsed) {
    throw new Error('test stat did not parse')
  }
  return parsed
}

const ROOT = stat({ pid: 100, pgrp: 100, session: 50, ttyNr: 34_816, tpgid: 200, startTime: '10' })
const FOREGROUND = stat({
  pid: 200,
  pgrp: 200,
  session: 50,
  ttyNr: 34_816,
  tpgid: 200,
  startTime: '20'
})

describe('parseLinuxProcessStat', () => {
  it('parses commands containing spaces and closing parentheses', () => {
    expect(
      parseLinuxProcessStat(
        statLine({ ...FOREGROUND, command: 'node worker ) helper', startTime: '123456' })
      )
    ).toEqual({ ...FOREGROUND, startTime: '123456' })
  })

  it.each(['', '100 bash S 1', '100 (bash) S 1 2'])('rejects malformed stat data', (raw) => {
    expect(parseLinuxProcessStat(raw)).toBeNull()
  })
})

describe('resolvePtyProcessCwd', () => {
  it('uses the validated foreground process-group leader cwd', async () => {
    const readProcessStat = vi
      .fn()
      .mockReturnValueOnce(ROOT)
      .mockReturnValueOnce(FOREGROUND)
      .mockReturnValueOnce(FOREGROUND)
      .mockReturnValueOnce(ROOT)
    const readProcessCwd = vi.fn(async (pid: number) => (pid === 200 ? '/home/test' : '/root'))

    await expect(
      resolvePtyProcessCwd(100, undefined, {
        platform: 'linux',
        readProcessCwd,
        readProcessStat
      })
    ).resolves.toBe('/home/test')
    expect(readProcessStat.mock.calls.map(([pid]) => pid)).toEqual([100, 200, 200, 100])
    expect(readProcessCwd).toHaveBeenCalledTimes(1)
    expect(readProcessCwd).toHaveBeenCalledWith(200, '')
  })

  it('reads only the tty foreground group leader, not arbitrary helper descendants', async () => {
    const readProcessStat = vi.fn((pid: number) => (pid === 100 ? ROOT : FOREGROUND))
    const readProcessCwd = vi.fn(async () => '/home/test')

    await resolvePtyProcessCwd(100, undefined, {
      platform: 'linux',
      readProcessCwd,
      readProcessStat
    })

    expect(new Set(readProcessStat.mock.calls.map(([pid]) => pid))).toEqual(new Set([100, 200]))
    expect(readProcessStat).not.toHaveBeenCalledWith(201)
  })

  it('uses the shell cwd while the shell owns the foreground process group', async () => {
    const foregroundShell = { ...ROOT, tpgid: 100 }
    const readProcessStat = vi.fn(() => foregroundShell)
    const readProcessCwd = vi.fn(async () => '/srv/current')

    await expect(
      resolvePtyProcessCwd(100, undefined, {
        platform: 'linux',
        readProcessCwd,
        readProcessStat
      })
    ).resolves.toBe('/srv/current')
    expect(readProcessCwd).toHaveBeenCalledWith(100, '')
  })

  it.each([
    { ...FOREGROUND, pgrp: 201 },
    { ...FOREGROUND, tpgid: 201 },
    { ...FOREGROUND, session: 51 },
    { ...FOREGROUND, ttyNr: 34_817 }
  ])('rejects a foreground candidate outside the PTY identity', async (candidate) => {
    const readProcessStat = vi.fn((pid: number) => (pid === 100 ? ROOT : candidate))
    const readProcessCwd = vi.fn(async (pid: number) => (pid === 100 ? '/root-live' : '/wrong'))

    await expect(
      resolvePtyProcessCwd(100, undefined, {
        platform: 'linux',
        readProcessCwd,
        readProcessStat
      })
    ).resolves.toBe('/root-live')
    expect(readProcessCwd).not.toHaveBeenCalledWith(200, '')
  })

  it('rejects a foreground PID reuse or group transition during the lookup', async () => {
    const reusedForeground = { ...FOREGROUND, startTime: '999' }
    const rootAfterTransition = { ...ROOT, tpgid: 100 }
    const readProcessStat = vi
      .fn()
      .mockReturnValueOnce(ROOT)
      .mockReturnValueOnce(FOREGROUND)
      .mockReturnValueOnce(reusedForeground)
      .mockReturnValueOnce(rootAfterTransition)
      .mockReturnValue(rootAfterTransition)
    const readProcessCwd = vi.fn(async (pid: number) =>
      pid === 200 ? '/stale-candidate' : '/root-live'
    )

    await expect(
      resolvePtyProcessCwd(100, undefined, {
        platform: 'linux',
        readProcessCwd,
        readProcessStat
      })
    ).resolves.toBe('/root-live')
    expect(readProcessCwd).toHaveBeenCalledWith(200, '')
    expect(readProcessCwd).toHaveBeenCalledWith(100, '')
  })

  it('pins the root PID to its captured start time and PTY slave', async () => {
    const identity = {
      slavePath: '/dev/pts/7',
      startTime: ROOT.startTime
    }
    const readProcessCwd = vi.fn(async () => '/wrong')

    await expect(
      resolvePtyProcessCwd(100, identity, {
        platform: 'linux',
        readProcessCwd,
        readProcessStat: () => ({ ...ROOT, startTime: 'reused' }),
        readProcessTerminal: () => '/dev/pts/7'
      })
    ).resolves.toBe('')
    await expect(
      resolvePtyProcessCwd(100, identity, {
        platform: 'linux',
        readProcessCwd,
        readProcessStat: () => ROOT,
        readProcessTerminal: () => '/dev/pts/8'
      })
    ).resolves.toBe('')
    expect(readProcessCwd).not.toHaveBeenCalled()
  })

  it('returns unknown instead of disguising a failed lookup as the launch cwd', async () => {
    const readProcessCwd = vi.fn(async (_pid: number, fallback: string) => fallback)

    await expect(
      resolvePtyProcessCwd(100, undefined, {
        platform: 'linux',
        readProcessCwd,
        readProcessStat: () => null
      })
    ).resolves.toBe('')
    await expect(
      resolvePtyProcessCwd(100, undefined, { platform: 'win32', readProcessCwd })
    ).resolves.toBe('')
    expect(readProcessCwd).not.toHaveBeenCalled()
  })

  it('leaves unsupported platforms to OSC and static fallbacks', async () => {
    const readProcessCwd = vi.fn(async (_pid: number, fallback: string) => fallback)
    await expect(
      resolvePtyProcessCwd(100, undefined, { platform: 'darwin', readProcessCwd })
    ).resolves.toBe('')
    expect(readProcessCwd).not.toHaveBeenCalled()
  })
})

describe('inspectPtyForegroundProcess', () => {
  it('classifies a validated foreground OpenSSH process and extracts its target', () => {
    const readProcessStat = vi
      .fn()
      .mockReturnValueOnce(ROOT)
      .mockReturnValueOnce(FOREGROUND)
      .mockReturnValueOnce(FOREGROUND)
      .mockReturnValueOnce(ROOT)
    const readProcessCommand = vi.fn(() => ({
      executable: '/usr/bin/ssh',
      argv: ['ssh', '-p', '2222', 'root@build-b']
    }))

    expect(
      inspectPtyForegroundProcess(100, undefined, {
        platform: 'linux',
        readProcessCommand,
        readProcessStat
      })
    ).toEqual({
      kind: 'ssh',
      epoch: '200:20',
      targetHint: 'build-b'
    })
    expect(readProcessStat.mock.calls.map(([pid]) => pid)).toEqual([100, 200, 200, 100])
    expect(readProcessCommand).toHaveBeenCalledWith(200)
  })

  it('classifies the root shell while it owns the PTY foreground group', () => {
    const shell = { ...ROOT, pgrp: 100, tpgid: 100 }
    expect(
      inspectPtyForegroundProcess(100, undefined, {
        platform: 'linux',
        readProcessCommand: () => ({ executable: '/usr/bin/bash', argv: ['bash'] }),
        readProcessStat: () => shell
      })
    ).toEqual({
      kind: 'shell',
      epoch: '100:10',
      targetHint: null
    })
  })

  it('fails closed across foreground PID reuse and process-group handoff races', () => {
    const readProcessStat = vi
      .fn()
      .mockReturnValueOnce(ROOT)
      .mockReturnValueOnce(FOREGROUND)
      .mockReturnValueOnce({ ...FOREGROUND, startTime: '999' })
      .mockReturnValueOnce({ ...ROOT, tpgid: 100 })

    expect(
      inspectPtyForegroundProcess(100, undefined, {
        platform: 'linux',
        readProcessCommand: () => ({ executable: '/usr/bin/ssh', argv: ['ssh', 'build-b'] }),
        readProcessStat
      })
    ).toEqual({ kind: 'unknown', epoch: null, targetHint: null })
  })

  it('pins inspection to the captured PTY slave and supported platform', () => {
    const identity = { slavePath: '/dev/pts/7', startTime: ROOT.startTime }
    expect(
      inspectPtyForegroundProcess(100, identity, {
        platform: 'linux',
        readProcessStat: () => ROOT,
        readProcessTerminal: () => '/dev/pts/8'
      })
    ).toEqual({ kind: 'unknown', epoch: null, targetHint: null })
    expect(inspectPtyForegroundProcess(100, identity, { platform: 'darwin' })).toEqual({
      kind: 'unknown',
      epoch: null,
      targetHint: null
    })
  })
})

describe('capturePtyProcessIdentity', () => {
  it('captures the root start time and slave path once at spawn', () => {
    expect(
      capturePtyProcessIdentity(100, '/dev/pts/7', {
        platform: 'linux',
        readProcessStat: () => ROOT
      })
    ).toEqual({
      slavePath: '/dev/pts/7',
      startTime: ROOT.startTime
    })
  })

  it('retains the PTY slave pin when the initial proc stat is not ready', () => {
    expect(
      capturePtyProcessIdentity(100, '/dev/pts/7', {
        platform: 'linux',
        readProcessStat: () => null
      })
    ).toEqual({ slavePath: '/dev/pts/7' })
  })
})
