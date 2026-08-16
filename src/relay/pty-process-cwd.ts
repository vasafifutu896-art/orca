import { closeSync, openSync, readFileSync, readlinkSync, readSync } from 'node:fs'
import { basename } from 'node:path'
import {
  UNKNOWN_PTY_TERMINAL_FOREGROUND,
  type PtyTerminalForeground
} from '../shared/pty-terminal-location'
import { parseOpenSshTargetHint } from '../shared/ssh-command-target'
import { isShellProcess } from '../shared/shell-process-detection'
import { resolveProcessCwd } from './pty-shell-utils'

type LinuxProcessStat = {
  pid: number
  pgrp: number
  session: number
  ttyNr: number
  tpgid: number
  startTime: string
}

export type PtyProcessIdentity = {
  slavePath?: string
  startTime?: string
}

type PtyProcessCwdDependencies = {
  platform?: NodeJS.Platform
  readProcessCommand?: (pid: number) => LinuxProcessCommand | null
  readProcessCwd?: (pid: number, fallback: string) => Promise<string>
  readProcessStat?: (pid: number) => LinuxProcessStat | null
  readProcessTerminal?: (pid: number) => string | null
}

type LinuxProcessCommand = {
  executable: string | null
  argv: string[]
}

type LinuxPtyForegroundSnapshot = {
  foreground: LinuxProcessStat
  root: LinuxProcessStat
}

const MAX_FOREGROUND_CMDLINE_BYTES = 8 * 1024

function parseInteger(value: string | undefined): number | null {
  if (!value || !/^-?\d+$/.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function parseLinuxProcessStat(raw: string): LinuxProcessStat | null {
  const closeParen = raw.lastIndexOf(')')
  const firstSpace = raw.indexOf(' ')
  if (firstSpace <= 0 || closeParen <= firstSpace || raw[closeParen + 1] !== ' ') {
    return null
  }

  const pid = parseInteger(raw.slice(0, firstSpace))
  const fields = raw
    .slice(closeParen + 2)
    .trim()
    .split(/\s+/)
  const pgrp = parseInteger(fields[2])
  const session = parseInteger(fields[3])
  const ttyNr = parseInteger(fields[4])
  const tpgid = parseInteger(fields[5])
  const startTime = fields[19]
  if (
    pid === null ||
    pid <= 0 ||
    pgrp === null ||
    session === null ||
    session <= 0 ||
    ttyNr === null ||
    tpgid === null ||
    !startTime ||
    !/^\d+$/.test(startTime)
  ) {
    return null
  }
  return { pid, pgrp, session, ttyNr, tpgid, startTime }
}

function readLinuxProcessStat(pid: number): LinuxProcessStat | null {
  try {
    return parseLinuxProcessStat(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return null
  }
}

function readLinuxProcessTerminal(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/fd/0`)
  } catch {
    return null
  }
}

function readLinuxProcessCommand(pid: number): LinuxProcessCommand | null {
  let executable: string | null = null
  let argv: string[] = []
  try {
    executable = readlinkSync(`/proc/${pid}/exe`)
  } catch {
    // A validated process can still hide its executable under procfs policy.
  }
  try {
    const fd = openSync(`/proc/${pid}/cmdline`, 'r')
    try {
      const buffer = Buffer.allocUnsafe(MAX_FOREGROUND_CMDLINE_BYTES + 1)
      const bytesRead = readSync(fd, buffer, 0, buffer.length, 0)
      // A truncated argv can move an option value into the destination slot.
      // Keep process classification from /proc/exe, but drop the display hint.
      if (bytesRead <= MAX_FOREGROUND_CMDLINE_BYTES) {
        argv = buffer.subarray(0, bytesRead).toString('utf8').split('\0').filter(Boolean)
      }
    } finally {
      closeSync(fd)
    }
  } catch {
    // The executable basename still classifies a restricted cmdline safely.
  }
  return executable || argv.length > 0 ? { executable, argv } : null
}

function sameProcess(left: LinuxProcessStat, right: LinuxProcessStat): boolean {
  return (
    left.pid === right.pid &&
    left.startTime === right.startTime &&
    left.session === right.session &&
    left.ttyNr === right.ttyNr
  )
}

function matchesCapturedRoot(stat: LinuxProcessStat, identity: PtyProcessIdentity | undefined) {
  return !identity?.startTime || stat.startTime === identity.startTime
}

function isForegroundGroupLeader(root: LinuxProcessStat, candidate: LinuxProcessStat): boolean {
  return (
    root.ttyNr > 0 &&
    root.tpgid > 0 &&
    candidate.pid === root.tpgid &&
    candidate.pgrp === root.tpgid &&
    candidate.tpgid === root.tpgid &&
    candidate.session === root.session &&
    candidate.ttyNr === root.ttyNr
  )
}

function readPtyForegroundSnapshot(
  rootPid: number,
  identity: PtyProcessIdentity | undefined,
  readProcessStat: (pid: number) => LinuxProcessStat | null,
  readProcessTerminal: (pid: number) => string | null
): LinuxPtyForegroundSnapshot | null {
  const root = readProcessStat(rootPid)
  if (
    !root ||
    root.pid !== rootPid ||
    !matchesCapturedRoot(root, identity) ||
    (identity?.slavePath && readProcessTerminal(rootPid) !== identity.slavePath)
  ) {
    return null
  }
  const foreground = root.tpgid === rootPid ? root : readProcessStat(root.tpgid)
  return foreground && isForegroundGroupLeader(root, foreground) ? { foreground, root } : null
}

function validatePtyForegroundSnapshot(
  before: LinuxPtyForegroundSnapshot,
  rootPid: number,
  identity: PtyProcessIdentity | undefined,
  readProcessStat: (pid: number) => LinuxProcessStat | null,
  readProcessTerminal: (pid: number) => string | null
): boolean {
  const foregroundAfter =
    before.foreground.pid === rootPid ? null : readProcessStat(before.foreground.pid)
  const rootAfter = readProcessStat(rootPid)
  const resolvedForegroundAfter = before.foreground.pid === rootPid ? rootAfter : foregroundAfter
  return Boolean(
    rootAfter &&
    resolvedForegroundAfter &&
    sameProcess(before.root, rootAfter) &&
    rootAfter.tpgid === before.foreground.pid &&
    sameProcess(before.foreground, resolvedForegroundAfter) &&
    isForegroundGroupLeader(rootAfter, resolvedForegroundAfter) &&
    matchesCapturedRoot(rootAfter, identity) &&
    (!identity?.slavePath || readProcessTerminal(rootPid) === identity.slavePath)
  )
}

function classifyForegroundProcess(
  stat: LinuxProcessStat,
  command: LinuxProcessCommand | null
): PtyTerminalForeground {
  const executableName = basename(command?.executable?.replace(/ \(deleted\)$/, '') ?? '')
  const argvName = basename(command?.argv[0] ?? '')
  const processName = (executableName || argvName).toLowerCase().replace(/\.exe$/, '')
  const epoch = `${stat.pid}:${stat.startTime}`
  if (processName === 'ssh') {
    return {
      kind: 'ssh',
      epoch,
      targetHint: command ? parseOpenSshTargetHint(command.argv) : null
    }
  }
  return {
    kind: processName ? (isShellProcess(processName) ? 'shell' : 'other') : 'unknown',
    epoch,
    targetHint: null
  }
}

export function inspectPtyForegroundProcess(
  rootPid: number,
  identity?: PtyProcessIdentity,
  dependencies: Omit<PtyProcessCwdDependencies, 'readProcessCwd'> = {}
): PtyTerminalForeground {
  if ((dependencies.platform ?? process.platform) !== 'linux') {
    return UNKNOWN_PTY_TERMINAL_FOREGROUND
  }
  const readProcessStat = dependencies.readProcessStat ?? readLinuxProcessStat
  const readProcessTerminal = dependencies.readProcessTerminal ?? readLinuxProcessTerminal
  const before = readPtyForegroundSnapshot(rootPid, identity, readProcessStat, readProcessTerminal)
  if (!before) {
    return UNKNOWN_PTY_TERMINAL_FOREGROUND
  }
  const command = (dependencies.readProcessCommand ?? readLinuxProcessCommand)(
    before.foreground.pid
  )
  return validatePtyForegroundSnapshot(
    before,
    rootPid,
    identity,
    readProcessStat,
    readProcessTerminal
  )
    ? classifyForegroundProcess(before.foreground, command)
    : UNKNOWN_PTY_TERMINAL_FOREGROUND
}

export function capturePtyProcessIdentity(
  rootPid: number,
  slavePath?: string,
  dependencies: Pick<PtyProcessCwdDependencies, 'platform' | 'readProcessStat'> = {}
): PtyProcessIdentity | undefined {
  if ((dependencies.platform ?? process.platform) !== 'linux') {
    return undefined
  }
  const stat = (dependencies.readProcessStat ?? readLinuxProcessStat)(rootPid)
  const identity: PtyProcessIdentity = {
    ...(slavePath ? { slavePath } : {}),
    ...(stat?.pid === rootPid ? { startTime: stat.startTime } : {})
  }
  return identity.slavePath || identity.startTime ? identity : undefined
}

export async function resolvePtyProcessCwd(
  rootPid: number,
  identity?: PtyProcessIdentity,
  dependencies: PtyProcessCwdDependencies = {}
): Promise<string> {
  const platform = dependencies.platform ?? process.platform
  const readProcessCwd = dependencies.readProcessCwd ?? resolveProcessCwd
  if (platform !== 'linux') {
    return ''
  }

  const readProcessStat = dependencies.readProcessStat ?? readLinuxProcessStat
  const readProcessTerminal = dependencies.readProcessTerminal ?? readLinuxProcessTerminal
  const rootBefore = readProcessStat(rootPid)
  if (
    !rootBefore ||
    rootBefore.pid !== rootPid ||
    !matchesCapturedRoot(rootBefore, identity) ||
    (identity?.slavePath && readProcessTerminal(rootPid) !== identity.slavePath)
  ) {
    return ''
  }

  const foregroundPid = rootBefore.tpgid
  const candidateBefore =
    foregroundPid > 0 && foregroundPid !== rootPid ? readProcessStat(foregroundPid) : null
  if (candidateBefore && isForegroundGroupLeader(rootBefore, candidateBefore)) {
    const candidateCwd = await readProcessCwd(foregroundPid, '')
    const candidateAfter = readProcessStat(foregroundPid)
    const rootAfter = readProcessStat(rootPid)
    if (
      candidateCwd &&
      rootAfter &&
      candidateAfter &&
      sameProcess(rootBefore, rootAfter) &&
      rootAfter.tpgid === foregroundPid &&
      sameProcess(candidateBefore, candidateAfter) &&
      isForegroundGroupLeader(rootAfter, candidateAfter) &&
      matchesCapturedRoot(rootAfter, identity) &&
      (!identity?.slavePath || readProcessTerminal(rootPid) === identity.slavePath)
    ) {
      return candidateCwd
    }
  }

  const rootCwd = await readProcessCwd(rootPid, '')
  const rootAfter = readProcessStat(rootPid)
  if (
    !rootCwd ||
    !rootAfter ||
    !sameProcess(rootBefore, rootAfter) ||
    !matchesCapturedRoot(rootAfter, identity) ||
    (identity?.slavePath && readProcessTerminal(rootPid) !== identity.slavePath)
  ) {
    return ''
  }
  return rootCwd
}
