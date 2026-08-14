import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const ERROR_NOT_SUPPORTED = 50
const ERROR_INVALID_PARAMETER = 87
const ERROR_MOD_NOT_FOUND = 126
const MAX_WINDOWS_PID = 0xfffffffe
const ADDON_FILENAME = 'windows-foreground-permission.node'

export type WindowsForegroundPermissionResult = {
  granted: boolean
  inputsSent: number
  errorCode: number
}

type WindowsForegroundPermissionAddon = {
  grantWindowsForegroundPermission: (pid: number) => unknown
}

type WindowsForegroundPermissionOptions = {
  platform?: NodeJS.Platform
  loadAddon?: () => WindowsForegroundPermissionAddon
}

function failure(errorCode: number): WindowsForegroundPermissionResult {
  return { granted: false, inputsSent: 0, errorCode }
}

function isValidPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && pid <= MAX_WINDOWS_PID
}

function isPermissionResult(value: unknown): value is WindowsForegroundPermissionResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const result = value as Partial<WindowsForegroundPermissionResult>
  return (
    typeof result.granted === 'boolean' &&
    Number.isInteger(result.inputsSent) &&
    result.inputsSent! >= 0 &&
    result.inputsSent! <= 2 &&
    Number.isInteger(result.errorCode) &&
    result.errorCode! >= 0 &&
    result.errorCode! <= 0xffffffff
  )
}

export function resolveWindowsForegroundPermissionAddonCandidates(options?: {
  isPackaged?: boolean
  resourcesPath?: string
  cwd?: string
  moduleDirectory?: string
}): string[] {
  const isPackaged =
    options?.isPackaged ?? (process.type === 'browser' && process.defaultApp === false)
  const resourcesPath = options?.resourcesPath ?? process.resourcesPath
  const packagedAddon = resourcesPath ? join(resourcesPath, 'bin', ADDON_FILENAME) : null
  if (isPackaged) {
    return packagedAddon ? [packagedAddon] : []
  }
  const cwd = options?.cwd ?? process.cwd()
  const moduleDirectory = options?.moduleDirectory ?? __dirname
  return [
    ...(packagedAddon ? [packagedAddon] : []),
    join(cwd, 'native', 'windows-foreground-permission', '.build', ADDON_FILENAME),
    resolve(
      moduleDirectory,
      '../../../native/windows-foreground-permission/.build',
      ADDON_FILENAME
    ),
    resolve(moduleDirectory, '../../native/windows-foreground-permission/.build', ADDON_FILENAME)
  ]
}

function loadPackagedOrDevAddon(): WindowsForegroundPermissionAddon {
  const candidates = resolveWindowsForegroundPermissionAddonCandidates()
  const addonPath = candidates.find((candidate) => existsSync(candidate))
  if (!addonPath) {
    throw new Error('Windows foreground permission addon is unavailable')
  }
  return createRequire(__filename)(addonPath) as WindowsForegroundPermissionAddon
}

export function createWindowsForegroundPermissionGrant(
  options: WindowsForegroundPermissionOptions = {}
): (pid: number) => WindowsForegroundPermissionResult {
  const platform = options.platform ?? process.platform
  const loadAddon = options.loadAddon ?? loadPackagedOrDevAddon
  let addon: WindowsForegroundPermissionAddon | null = null

  return (pid) => {
    if (!isValidPid(pid)) {
      return failure(ERROR_INVALID_PARAMETER)
    }
    if (platform !== 'win32') {
      return failure(ERROR_NOT_SUPPORTED)
    }
    try {
      addon ??= loadAddon()
      const result = addon.grantWindowsForegroundPermission(pid)
      return isPermissionResult(result) ? result : failure(ERROR_MOD_NOT_FOUND)
    } catch {
      return failure(ERROR_MOD_NOT_FOUND)
    }
  }
}

const grantWithDefaultAddon = createWindowsForegroundPermissionGrant()

export function grantWindowsForegroundPermission(pid: number): WindowsForegroundPermissionResult {
  return grantWithDefaultAddon(pid)
}
