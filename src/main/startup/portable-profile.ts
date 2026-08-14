import type { App } from 'electron'
import { win32 as winPath } from 'node:path'

type PortableProfileOptions = {
  app: Pick<App, 'setPath'>
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  isDev: boolean
}

export function isPortableWindowsProcess(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  return (
    platform === 'win32' &&
    Boolean(env.PORTABLE_EXECUTABLE_DIR?.trim()) &&
    Boolean(env.PORTABLE_EXECUTABLE_FILE?.trim())
  )
}

export function resolvePortableUserDataPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!isPortableWindowsProcess(env, platform) || env.ORCA_E2E_USER_DATA_DIR) {
    return null
  }
  return winPath.join(winPath.resolve(env.PORTABLE_EXECUTABLE_DIR!.trim()), 'OrcaData')
}

export function configurePortableUserDataPath(options: PortableProfileOptions): string | null {
  if (options.isDev) {
    return null
  }
  const userDataPath = resolvePortableUserDataPath(options.env, options.platform)
  if (!userDataPath) {
    return null
  }
  options.app.setPath('userData', userDataPath)
  return userDataPath
}
