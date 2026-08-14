import { win32 as winPath } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  FOLDER_PORTABLE_MARKER,
  configurePortableUserDataPath,
  isPortableWindowsProcess,
  resolvePortableUserDataPath
} from './portable-profile'

const portableEnv = {
  PORTABLE_EXECUTABLE_DIR: 'D:\\Tools\\Orca',
  PORTABLE_EXECUTABLE_FILE: 'D:\\Tools\\Orca\\orca-windows-portable.exe'
}
const folderPortableExe = 'D:\\Tools\\Orca Folder\\Orca.exe'
const folderPortableMarker = winPath.join(
  winPath.dirname(folderPortableExe),
  FOLDER_PORTABLE_MARKER
)
const markerExists = (path: string): boolean => path === folderPortableMarker

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

  it('stores folder-portable data beside an executable with the marker', () => {
    expect(isPortableWindowsProcess({}, 'win32', folderPortableExe, markerExists)).toBe(true)
    expect(resolvePortableUserDataPath({}, 'win32', folderPortableExe, markerExists)).toBe(
      'D:\\Tools\\Orca Folder\\OrcaData'
    )

    const setPath = vi.fn()
    expect(
      configurePortableUserDataPath({
        app: { setPath },
        env: {},
        platform: 'win32',
        executablePath: folderPortableExe,
        pathExists: markerExists,
        isDev: false
      })
    ).toBe('D:\\Tools\\Orca Folder\\OrcaData')
    expect(setPath).toHaveBeenCalledWith('userData', 'D:\\Tools\\Orca Folder\\OrcaData')
  })

  it('prefers the NSIS outer executable directory when a folder marker also exists', () => {
    expect(resolvePortableUserDataPath(portableEnv, 'win32', folderPortableExe, markerExists)).toBe(
      'D:\\Tools\\Orca\\OrcaData'
    )
  })

  it.each([
    ['installed Windows build', 'win32'],
    ['marked non-Windows build', 'linux']
  ])('does not treat an %s as folder portable', (_name, platform) => {
    const pathExists = platform === 'win32' ? () => false : markerExists
    expect(
      isPortableWindowsProcess({}, platform as NodeJS.Platform, folderPortableExe, pathExists)
    ).toBe(false)
  })

  it('keeps the E2E userData override ahead of a folder-portable marker', () => {
    expect(
      resolvePortableUserDataPath(
        { ORCA_E2E_USER_DATA_DIR: 'D:\\e2e' },
        'win32',
        folderPortableExe,
        markerExists
      )
    ).toBeNull()
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
