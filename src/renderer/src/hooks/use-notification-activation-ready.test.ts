// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotificationActivationReady } from './use-notification-activation-ready'

describe('useNotificationActivationReady', () => {
  let frameCallback: FrameRequestCallback | null
  let signalReady: ReturnType<typeof vi.fn>

  beforeEach(() => {
    frameCallback = null
    signalReady = vi.fn(() => Promise.resolve())
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback
      return 17
    })
    vi.spyOn(window, 'cancelAnimationFrame')
    Object.assign(window, {
      api: { ui: { signalNotificationActivationReady: signalReady } }
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('waits for listeners and workspace recovery, then signals after one frame', () => {
    const hook = renderHook(
      ({ listenersReady, workspaceReady }) =>
        useNotificationActivationReady(listenersReady, workspaceReady),
      { initialProps: { listenersReady: false, workspaceReady: false } }
    )

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    hook.rerender({ listenersReady: true, workspaceReady: false })
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    hook.rerender({ listenersReady: true, workspaceReady: true })
    expect(window.requestAnimationFrame).toHaveBeenCalledOnce()
    expect(signalReady).not.toHaveBeenCalled()

    act(() => frameCallback?.(performance.now()))
    expect(signalReady).toHaveBeenCalledOnce()
  })

  it('cancels a pending frame when recovery becomes unavailable', () => {
    const hook = renderHook(({ ready }) => useNotificationActivationReady(ready, ready), {
      initialProps: { ready: true }
    })

    hook.rerender({ ready: false })
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(17)
  })
})
