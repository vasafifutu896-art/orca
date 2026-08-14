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
})
