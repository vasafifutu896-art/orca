import { describe, expect, it, vi } from 'vitest'
import {
  createWindowsForegroundPermissionGrant,
  resolveWindowsForegroundPermissionAddonCandidates
} from './windows-foreground-permission'

describe('Windows foreground permission runtime', () => {
  it('fails closed without loading the addon off Windows', () => {
    const loadAddon = vi.fn()
    const grant = createWindowsForegroundPermissionGrant({ platform: 'linux', loadAddon })

    expect(grant(1234)).toEqual({ granted: false, inputsSent: 0, errorCode: 50 })
    expect(loadAddon).not.toHaveBeenCalled()
  })

  it('never falls back to the working directory in a packaged app', () => {
    expect(
      resolveWindowsForegroundPermissionAddonCandidates({
        isPackaged: true,
        resourcesPath: 'C:\\Program Files\\Orca\\resources',
        cwd: 'C:\\untrusted-repo',
        moduleDirectory: 'C:\\untrusted-repo\\out\\main'
      })
    ).toEqual(['C:\\Program Files\\Orca\\resources/bin/windows-foreground-permission.node'])

    expect(
      resolveWindowsForegroundPermissionAddonCandidates({
        isPackaged: false,
        resourcesPath: undefined,
        cwd: 'C:\\dev\\orca',
        moduleDirectory: 'C:\\dev\\orca\\out\\main'
      })
    ).toContain(
      'C:\\dev\\orca/native/windows-foreground-permission/.build/windows-foreground-permission.node'
    )
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0xffffffff])(
    'rejects invalid pid %s before loading native code',
    (pid) => {
      const loadAddon = vi.fn()
      const grant = createWindowsForegroundPermissionGrant({ platform: 'win32', loadAddon })

      expect(grant(pid)).toEqual({ granted: false, inputsSent: 0, errorCode: 87 })
      expect(loadAddon).not.toHaveBeenCalled()
    }
  )

  it('loads the addon lazily once and preserves its structured result', () => {
    const nativeGrant = vi
      .fn()
      .mockReturnValueOnce({ granted: true, inputsSent: 2, errorCode: 0 })
      .mockReturnValueOnce({ granted: false, inputsSent: 2, errorCode: 5 })
    const loadAddon = vi.fn(() => ({ grantWindowsForegroundPermission: nativeGrant }))
    const grant = createWindowsForegroundPermissionGrant({ platform: 'win32', loadAddon })

    expect(loadAddon).not.toHaveBeenCalled()
    expect(grant(1234)).toEqual({ granted: true, inputsSent: 2, errorCode: 0 })
    expect(grant(5678)).toEqual({ granted: false, inputsSent: 2, errorCode: 5 })
    expect(loadAddon).toHaveBeenCalledOnce()
    expect(nativeGrant).toHaveBeenNthCalledWith(1, 1234)
    expect(nativeGrant).toHaveBeenNthCalledWith(2, 5678)
  })

  it('fails closed when the addon cannot load, throws, or returns malformed data', () => {
    for (const loadAddon of [
      () => {
        throw new Error('missing addon')
      },
      () => ({
        grantWindowsForegroundPermission: () => {
          throw new Error('native failure')
        }
      }),
      () => ({
        grantWindowsForegroundPermission: () => ({
          granted: true,
          inputsSent: 3,
          errorCode: 0
        })
      })
    ]) {
      const grant = createWindowsForegroundPermissionGrant({ platform: 'win32', loadAddon })
      expect(grant(1234)).toEqual({ granted: false, inputsSent: 0, errorCode: 126 })
    }
  })
})
