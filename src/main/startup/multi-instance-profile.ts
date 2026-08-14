import type { App } from 'electron'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export const MULTI_INSTANCE_SLOT_ARG_PREFIX = '--orca-instance-slot='
export const MULTI_INSTANCE_DISABLE_ENV = 'ORCA_DISABLE_MULTI_INSTANCE'
const MAX_INSTANCE_SLOTS = 32
const INCOMPLETE_LOCK_STALE_MS = 10_000

type InstanceLockRecord = {
  pid: number
  token: string
  claimedAt: number
}

type InstanceLockClaim = {
  lockPath: string
  pid: number
  token: string
}

export type MultiInstanceProfile = {
  slot: number
  userDataPath: string
  ensureClaimed: () => boolean
  release: () => void
}

type ConfigureMultiInstanceProfileOptions = {
  app: Pick<App, 'getPath' | 'setPath'>
  argv?: string[]
  env?: NodeJS.ProcessEnv
  isDev: boolean
  isServeMode: boolean
  pid?: number
  token?: string
  now?: () => number
  isProcessAlive?: (pid: number) => boolean
}

function parseRequestedSlot(argv: readonly string[]): number | null {
  const raw = argv
    .find((arg) => arg.startsWith(MULTI_INSTANCE_SLOT_ARG_PREFIX))
    ?.slice(MULTI_INSTANCE_SLOT_ARG_PREFIX.length)
  if (!raw || !/^\d+$/.test(raw)) {
    return null
  }
  const slot = Number(raw)
  return Number.isInteger(slot) && slot >= 1 && slot <= MAX_INSTANCE_SLOTS ? slot : null
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readLockRecord(lockPath: string): InstanceLockRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as InstanceLockRecord).pid === 'number' &&
      typeof (parsed as InstanceLockRecord).token === 'string' &&
      typeof (parsed as InstanceLockRecord).claimedAt === 'number'
    ) {
      return parsed as InstanceLockRecord
    }
  } catch {
    return null
  }
  return null
}

function removeStaleLock(
  lockPath: string,
  now: number,
  isProcessAlive: (pid: number) => boolean
): boolean {
  const record = readLockRecord(lockPath)
  if (record) {
    if (isProcessAlive(record.pid)) {
      return false
    }
  } else {
    try {
      if (now - statSync(lockPath).mtimeMs < INCOMPLETE_LOCK_STALE_MS) {
        return false
      }
    } catch {
      return true
    }
  }
  try {
    unlinkSync(lockPath)
    return true
  } catch {
    return false
  }
}

function tryClaimSlot(args: {
  lockRoot: string
  slot: number
  pid: number
  token: string
  now: number
  isProcessAlive: (pid: number) => boolean
}): InstanceLockClaim | null {
  mkdirSync(args.lockRoot, { recursive: true, mode: 0o700 })
  const lockPath = join(args.lockRoot, `slot-${args.slot}.json`)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      try {
        writeFileSync(
          fd,
          `${JSON.stringify({ pid: args.pid, token: args.token, claimedAt: args.now })}\n`,
          'utf8'
        )
      } finally {
        closeSync(fd)
      }
      return { lockPath, pid: args.pid, token: args.token }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      if (!removeStaleLock(lockPath, args.now, args.isProcessAlive)) {
        return null
      }
    }
  }
  return null
}

function releaseClaim(claim: InstanceLockClaim | null): void {
  if (!claim) {
    return
  }
  const current = readLockRecord(claim.lockPath)
  if (current?.pid !== claim.pid || current.token !== claim.token) {
    return
  }
  try {
    unlinkSync(claim.lockPath)
  } catch {
    // Best-effort: a crash-safe stale-PID check reclaims this slot next launch.
  }
}

function seedSecondaryProfile(baseUserDataPath: string, userDataPath: string): void {
  const targetFile = join(userDataPath, 'orca-data.json')
  if (existsSync(targetFile)) {
    return
  }
  const sourceFile = join(baseUserDataPath, 'orca-data.json')
  if (!existsSync(sourceFile)) {
    return
  }
  try {
    const source: unknown = JSON.parse(readFileSync(sourceFile, 'utf8'))
    if (typeof source !== 'object' || source === null) {
      return
    }
    const state = source as Record<string, unknown>
    const seed = {
      ...(state.settings && typeof state.settings === 'object' ? { settings: state.settings } : {}),
      sshTargets: Array.isArray(state.sshTargets) ? state.sshTargets : [],
      deletedSshConfigAliases: Array.isArray(state.deletedSshConfigAliases)
        ? state.deletedSshConfigAliases
        : [],
      removedSshTargetTombstones: Array.isArray(state.removedSshTargetTombstones)
        ? state.removedSshTargetTombstones
        : []
    }
    mkdirSync(userDataPath, { recursive: true, mode: 0o700 })
    writeFileSync(targetFile, `${JSON.stringify(seed, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
  } catch (error) {
    console.warn('[multi-instance] Failed to seed secondary profile:', error)
  }
}

export function configureMultiInstanceProfile(
  options: ConfigureMultiInstanceProfileOptions
): MultiInstanceProfile | null {
  const env = options.env ?? process.env
  if (
    options.isDev ||
    options.isServeMode ||
    env[MULTI_INSTANCE_DISABLE_ENV] === '1' ||
    env.ORCA_E2E_USER_DATA_DIR
  ) {
    return null
  }

  const argv = options.argv ?? process.argv
  const pid = options.pid ?? process.pid
  const token = options.token ?? randomUUID()
  const now = (options.now ?? Date.now)()
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive
  const baseUserDataPath = options.app.getPath('userData')
  const lockRoot = join(baseUserDataPath, 'instance-locks')
  const requestedSlot = parseRequestedSlot(argv)
  let slot = requestedSlot ?? 1
  let claim: InstanceLockClaim | null = null

  if (requestedSlot !== null) {
    claim = tryClaimSlot({ lockRoot, slot, pid, token, now, isProcessAlive })
  } else {
    for (slot = 1; slot <= MAX_INSTANCE_SLOTS; slot += 1) {
      claim = tryClaimSlot({ lockRoot, slot, pid, token, now, isProcessAlive })
      if (claim) {
        break
      }
    }
    if (!claim) {
      throw new Error(`No free Orca instance slot (maximum ${MAX_INSTANCE_SLOTS})`)
    }
    argv.push(`${MULTI_INSTANCE_SLOT_ARG_PREFIX}${slot}`)
  }

  const userDataPath =
    slot === 1 ? baseUserDataPath : join(baseUserDataPath, 'instances', `slot-${slot}`)
  if (slot > 1) {
    seedSecondaryProfile(baseUserDataPath, userDataPath)
    options.app.setPath('userData', userDataPath)
  }

  return {
    slot,
    userDataPath,
    ensureClaimed: () => {
      if (claim) {
        return true
      }
      claim = tryClaimSlot({ lockRoot, slot, pid, token, now: Date.now(), isProcessAlive })
      return claim !== null
    },
    release: () => {
      releaseClaim(claim)
      claim = null
    }
  }
}

export function formatMultiInstanceWindowTitle(title: string, slot: number | undefined): string {
  return slot && slot > 1 ? `${title} · ${slot}` : title
}
