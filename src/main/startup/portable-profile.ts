import type { App } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, win32 as winPath } from 'node:path'

export const FOLDER_PORTABLE_MARKER = '.orca-portable'

type PathExists = (path: string) => boolean

type PortableProfileOptions = {
  app: Pick<App, 'setPath'>
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  executablePath?: string
  pathExists?: PathExists
  isDev: boolean
}

function resolveFolderPortableRoot(executablePath: string, pathExists: PathExists): string | null {
  // Native paths support real filesystem tests off Windows; win32 paths support injected fixtures.
  const nativeRoot = dirname(resolve(executablePath))
  const windowsRoot = winPath.dirname(winPath.resolve(executablePath))
  const candidates = [
    { root: nativeRoot, marker: join(nativeRoot, FOLDER_PORTABLE_MARKER) },
    { root: windowsRoot, marker: winPath.join(windowsRoot, FOLDER_PORTABLE_MARKER) }
  ]
  for (const candidate of candidates) {
    if (pathExists(candidate.marker)) {
      return candidate.root
    }
  }
  return null
}

function resolvePortableRoot(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  executablePath: string,
  pathExists: PathExists
): string | null {
  if (platform !== 'win32') {
    return null
  }
  if (env.PORTABLE_EXECUTABLE_DIR?.trim() && env.PORTABLE_EXECUTABLE_FILE?.trim()) {
    return winPath.resolve(env.PORTABLE_EXECUTABLE_DIR.trim())
  }
  const normalizedExecutablePath = executablePath.trim()
  return normalizedExecutablePath
    ? resolveFolderPortableRoot(normalizedExecutablePath, pathExists)
    : null
}

export function isPortableWindowsProcess(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  executablePath: string = process.execPath,
  pathExists: PathExists = existsSync
): boolean {
  return resolvePortableRoot(env, platform, executablePath, pathExists) !== null
}

export function resolvePortableUserDataPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  executablePath: string = process.execPath,
  pathExists: PathExists = existsSync
): string | null {
  if (env.ORCA_E2E_USER_DATA_DIR) {
    return null
  }
  const portableRoot = resolvePortableRoot(env, platform, executablePath, pathExists)
  return portableRoot ? winPath.join(portableRoot, 'OrcaData') : null
}

export function configurePortableUserDataPath(options: PortableProfileOptions): string | null {
  if (options.isDev) {
    return null
  }
  const userDataPath = resolvePortableUserDataPath(
    options.env,
    options.platform,
    options.executablePath,
    options.pathExists
  )
  if (!userDataPath) {
    return null
  }
  options.app.setPath('userData', userDataPath)
  return userDataPath
}
