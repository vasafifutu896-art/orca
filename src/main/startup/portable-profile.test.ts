import { describe, expect, it, vi } from 'vitest'
import {
  configurePortableUserDataPath,
  isPortableWindowsProcess,
  resolvePortableUserDataPath
} from './portable-profile'

const portableEnv = {
  PORTABLE_EXECUTABLE_DIR: 'D:\\Tools\\Orca',
  PORTABLE_EXECUTABLE_FILE: 'D:\\Tools\\Orca\\orca-windows-portable.exe'
}

describe('portable profile', () => {
  it('stores Windows portable data beside the outer executable', () => {
    expect(isPortableWindowsProcess(portableEnv, 'win32')).toBe(true)
    expect(resolvePortableUserDataPath(portableEnv, 'win32')).toBe('D:\\Tools\\Orca\\OrcaData')

    const setPath = vi.fn()
    expect(
      configurePortableUserDataPath({
        app: { setPath },
        env: portableEnv,
        platform: 'win32',
        isDev: false
      })
    ).toBe('D:\\Tools\\Orca\\OrcaData')
    expect(setPath).toHaveBeenCalledWith('userData', 'D:\\Tools\\Orca\\OrcaData')
  })

  it.each([
    ['installed Windows build', { PORTABLE_EXECUTABLE_DIR: 'D:\\Tools\\Orca' }, 'win32', false],
    ['non-Windows build', portableEnv, 'linux', false],
    ['development build', portableEnv, 'win32', true],
    ['E2E override', { ...portableEnv, ORCA_E2E_USER_DATA_DIR: 'D:\\e2e' }, 'win32', false]
  ])('does not redirect an %s', (_name, env, platform, isDev) => {
    const setPath = vi.fn()
    expect(
      configurePortableUserDataPath({
        app: { setPath },
        env,
        platform: platform as NodeJS.Platform,
        isDev
      })
    ).toBeNull()
    expect(setPath).not.toHaveBeenCalled()
  })
})
