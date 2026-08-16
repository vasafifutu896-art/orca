import { readFileSync, readlinkSync } from 'node:fs'
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
  readProcessCwd?: (pid: number, fallback: string) => Promise<string>
  readProcessStat?: (pid: number) => LinuxProcessStat | null
  readProcessTerminal?: (pid: number) => string | null
}

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
