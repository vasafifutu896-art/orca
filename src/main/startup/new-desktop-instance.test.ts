import { describe, expect, it, vi } from 'vitest'
import { launchNewDesktopInstance } from './new-desktop-instance'

describe('launchNewDesktopInstance', () => {
  it('starts a detached process without pinning it to the current slot', () => {
    const unref = vi.fn()
    const once = vi.fn()
    const spawn = vi.fn(() => ({ unref, once }))

    expect(
      launchNewDesktopInstance({
        executable: '/opt/Orca/orca',
        argv: ['/opt/Orca/orca', '--no-sandbox', '--orca-instance-slot=2'],
        spawn
      })
    ).toBe(true)

    expect(spawn).toHaveBeenCalledWith('/opt/Orca/orca', ['--no-sandbox'], {
      detached: true,
      stdio: 'ignore'
    })
    expect(once).toHaveBeenCalledWith('error', expect.any(Function))
    expect(unref).toHaveBeenCalledTimes(1)
  })

  it('relaunches the outer portable executable instead of its temporary extracted app', () => {
    const spawn = vi.fn(() => ({ unref: vi.fn(), once: vi.fn() }))

    launchNewDesktopInstance({
      argv: ['C:\\Temp\\portable\\Orca.exe', '--orca-instance-slot=3'],
      env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\orca-windows-portable.exe' },
      spawn
    })

    expect(spawn).toHaveBeenCalledWith('D:\\Apps\\orca-windows-portable.exe', [], {
      detached: true,
      stdio: 'ignore'
    })
  })
})
