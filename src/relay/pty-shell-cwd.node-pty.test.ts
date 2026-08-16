import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import { readPtySlavePath } from '../shared/pty-slave-line-discipline-echo'
import {
  capturePtyProcessIdentity,
  resolvePtyProcessCwd,
  type PtyProcessIdentity
} from './pty-process-cwd'
import { resolveProcessCwd } from './pty-shell-utils'

const linuxOnly = process.platform === 'linux' ? describe : describe.skip

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

async function waitForCwd(
  pid: number,
  identity: PtyProcessIdentity | undefined,
  expected: string
): Promise<string> {
  const deadline = Date.now() + 3_000
  let cwd = ''
  while (Date.now() < deadline) {
    cwd = await resolvePtyProcessCwd(pid, identity)
    if (cwd === expected) {
      return cwd
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return cwd
}

linuxOnly('relay PTY working directory', () => {
  let root = ''
  let terminal: pty.IPty | null = null

  afterEach(() => {
    terminal?.kill()
    terminal = null
    if (root) {
      rmSync(root, { recursive: true, force: true })
      root = ''
    }
  })

  it('resolves the cwd of a foreground command instead of its waiting shell', async () => {
    root = mkdtempSync(join(tmpdir(), 'orca-relay-cwd-'))
    const initialCwd = join(root, 'initial')
    const commandCwd = join(root, 'working')
    mkdirSync(initialCwd)
    mkdirSync(commandCwd)
    terminal = pty.spawn('/bin/bash', ['--noprofile', '--norc'], {
      cols: 80,
      rows: 24,
      cwd: initialCwd,
      env: { ...process.env, TERM: 'xterm-256color' }
    })
    const identity = capturePtyProcessIdentity(terminal.pid, readPtySlavePath(terminal))
    expect(identity).toBeDefined()

    terminal.write(`bash -c 'cd "$1"; sleep 5' _ ${quotePosix(commandCwd)}\r`)

    await expect(waitForCwd(terminal.pid, identity, commandCwd)).resolves.toBe(commandCwd)
    await expect(resolveProcessCwd(terminal.pid, '')).resolves.toBe(initialCwd)
  })
})
