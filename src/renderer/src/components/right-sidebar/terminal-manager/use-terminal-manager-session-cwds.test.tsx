// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalManagerSessionCwds } from './use-terminal-manager-session-cwds'

const getCwdMock = vi.fn<(ptyId: string) => Promise<string>>()
const originalApi = window.api

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useTerminalManagerSessionCwds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getCwdMock.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...originalApi,
        pty: { ...originalApi?.pty, getCwd: getCwdMock }
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: originalApi
    })
  })

  it('polls visible local and SSH sessions and updates after cd', async () => {
    getCwdMock.mockImplementation(async (ptyId) =>
      ptyId.startsWith('ssh:') ? '/srv/project' : '/repo'
    )
    const targets = [
      { tabId: 'local-tab', ptyId: 'local-pty' },
      { tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty' }
    ]
    const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))

    await act(flushPromises)
    expect(result.current).toEqual({
      'local-tab': { ptyId: 'local-pty', cwd: '/repo' },
      'ssh-tab': { ptyId: 'ssh:host-1@@remote-pty', cwd: '/srv/project' }
    })

    getCwdMock.mockImplementation(async (ptyId) =>
      ptyId === 'local-pty' ? '/repo/packages/web' : '/srv/project'
    )
    await act(async () => {
      vi.advanceTimersByTime(15_000)
      await flushPromises()
    })

    expect(result.current['local-tab']?.cwd).toBe('/repo/packages/web')
  })

  it('refreshes the active direct SSH cwd promptly while a command is running', async () => {
    getCwdMock.mockResolvedValueOnce('/root').mockResolvedValue('/home/test')
    const targets = [{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty', priority: true }]
    const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))

    await act(flushPromises)
    expect(result.current['ssh-tab']?.cwd).toBe('/root')

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await flushPromises()
    })

    expect(result.current['ssh-tab']?.cwd).toBe('/home/test')
  })

  it('stops the fast direct SSH refresh when the row is no longer visible', async () => {
    getCwdMock.mockResolvedValue('/home/test')
    const targets = [{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty', priority: true }]
    const view = renderHook(({ targets }) => useTerminalManagerSessionCwds(targets), {
      initialProps: { targets }
    })
    await act(flushPromises)
    expect(getCwdMock).toHaveBeenCalledTimes(1)

    view.rerender({ targets: [] })
    getCwdMock.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(15_000)
      await flushPromises()
    })

    expect(getCwdMock).not.toHaveBeenCalled()
  })

  it.each(['empty', 'error'] as const)(
    'drops a stale direct SSH poll result after an %s provider response',
    async (failure) => {
      getCwdMock.mockResolvedValueOnce('/srv/old')
      if (failure === 'empty') {
        getCwdMock.mockResolvedValue('')
      } else {
        getCwdMock.mockRejectedValue(new Error('relay unavailable'))
      }
      const targets = [{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty', priority: true }]
      const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))
      await act(flushPromises)
      expect(result.current['ssh-tab']?.cwd).toBe('/srv/old')

      await act(async () => {
        vi.advanceTimersByTime(2_000)
        await flushPromises()
      })

      expect(result.current['ssh-tab']).toBeUndefined()
    }
  )

  it('keeps a result scoped to its PTY across reconnects and skips runtime handles', async () => {
    getCwdMock.mockResolvedValue('/repo/old')
    const { result, rerender } = renderHook(
      ({ targets }) => useTerminalManagerSessionCwds(targets),
      { initialProps: { targets: [{ tabId: 'tab-1', ptyId: 'pty-old' }] } }
    )
    await act(flushPromises)

    getCwdMock.mockResolvedValue('/repo/new')
    rerender({ targets: [{ tabId: 'tab-1', ptyId: 'pty-new' }] })
    await act(flushPromises)
    expect(result.current['tab-1']).toEqual({ ptyId: 'pty-new', cwd: '/repo/new' })

    getCwdMock.mockClear()
    rerender({ targets: [{ tabId: 'tab-1', ptyId: 'remote:env-1@@terminal-1' }] })
    await act(flushPromises)
    expect(getCwdMock).not.toHaveBeenCalled()
  })

  it('lets a responsive session update while another SSH lookup is still pending', async () => {
    let resolveSlow: (cwd: string) => void = () => undefined
    getCwdMock.mockImplementation((ptyId) =>
      ptyId === 'slow-pty'
        ? new Promise<string>((resolve) => {
            resolveSlow = resolve
          })
        : Promise.resolve('/repo/fast')
    )
    const targets = [
      { tabId: 'slow-tab', ptyId: 'slow-pty' },
      { tabId: 'fast-tab', ptyId: 'fast-pty' }
    ]
    const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))

    await act(flushPromises)
    expect(result.current['fast-tab']?.cwd).toBe('/repo/fast')
    expect(result.current['slow-tab']).toBeUndefined()

    await act(async () => {
      resolveSlow('/srv/slow')
      await flushPromises()
    })
    expect(result.current['slow-tab']?.cwd).toBe('/srv/slow')
  })

  it('bounds the initial lookup fan-out and drains queued sessions', async () => {
    const resolvers = new Map<string, (cwd: string) => void>()
    getCwdMock.mockImplementation(
      (ptyId) =>
        new Promise<string>((resolve) => {
          resolvers.set(ptyId, resolve)
        })
    )
    const targets = [
      { tabId: 'tab-1', ptyId: 'pty-1' },
      { tabId: 'tab-2', ptyId: 'pty-2' },
      { tabId: 'tab-3', ptyId: 'pty-3' }
    ]
    renderHook(() => useTerminalManagerSessionCwds(targets))

    expect(getCwdMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolvers.get('pty-1')?.('/one')
      await flushPromises()
    })
    expect(getCwdMock).toHaveBeenCalledTimes(3)
  })

  it('keeps one concurrency budget across equivalent rerenders and target changes', async () => {
    const resolvers = new Map<string, (cwd: string) => void>()
    getCwdMock.mockImplementation(
      (ptyId) =>
        new Promise<string>((resolve) => {
          resolvers.set(ptyId, resolve)
        })
    )
    const initialTargets = [
      { tabId: 'tab-1', ptyId: 'pty-1' },
      { tabId: 'tab-2', ptyId: 'pty-2' },
      { tabId: 'tab-3', ptyId: 'pty-3' }
    ]
    const view = renderHook(({ targets }) => useTerminalManagerSessionCwds(targets), {
      initialProps: { targets: initialTargets }
    })

    expect(getCwdMock).toHaveBeenCalledTimes(2)
    view.rerender({ targets: initialTargets.map((target) => ({ ...target })) })
    expect(getCwdMock).toHaveBeenCalledTimes(2)

    view.rerender({
      targets: [
        { tabId: 'tab-3', ptyId: 'pty-3' },
        { tabId: 'tab-4', ptyId: 'pty-4' }
      ]
    })
    expect(getCwdMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolvers.get('pty-1')?.('/one')
      await flushPromises()
    })
    expect(getCwdMock).toHaveBeenCalledTimes(3)
    expect(getCwdMock).toHaveBeenLastCalledWith('pty-3')
  })
})
