// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyTerminalLocationReadResult } from '../../../../../shared/pty-terminal-location'
import { useTerminalManagerSessionCwds } from './use-terminal-manager-session-cwds'

const getCwdMock = vi.fn<(ptyId: string) => Promise<string>>()
const getTerminalLocationMock = vi.fn<(ptyId: string) => Promise<PtyTerminalLocationReadResult>>()
const originalApi = window.api

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useTerminalManagerSessionCwds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getCwdMock.mockReset()
    getTerminalLocationMock.mockReset()
    getTerminalLocationMock.mockResolvedValue({ status: 'unsupported' })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ...originalApi,
        pty: {
          ...originalApi?.pty,
          getCwd: getCwdMock,
          getTerminalLocation: getTerminalLocationMock
        }
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

  it('uses the innermost SSH host and cwd from the structured probe', async () => {
    getTerminalLocationMock.mockResolvedValue({
      status: 'available',
      probe: {
        incarnationId: 'relay-1',
        foreground: { kind: 'ssh', epoch: '42:10', targetHint: 'jump-host' },
        outerCwd: '/root',
        nestedLocation: {
          cwd: '/home/test',
          host: 'inner.example',
          source: 'osc7',
          outputSeq: 3
        }
      }
    })
    const targets = [{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty', priority: true }]
    const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))

    await act(flushPromises)

    expect(result.current['ssh-tab']).toEqual({
      ptyId: 'ssh:host-1@@remote-pty',
      cwd: '/home/test',
      hostHint: 'inner.example',
      nestedSsh: true
    })
    expect(getCwdMock).not.toHaveBeenCalled()
  })

  it('keeps a nested SSH cwd unknown until the inner shell reports one', async () => {
    getTerminalLocationMock.mockResolvedValue({
      status: 'available',
      probe: {
        incarnationId: 'relay-1',
        foreground: { kind: 'ssh', epoch: '42:10', targetHint: 'inner.example' },
        outerCwd: '/root',
        nestedLocation: null
      }
    })
    const targets = [{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty', priority: true }]
    const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))

    await act(flushPromises)

    expect(result.current['ssh-tab']).toEqual({
      ptyId: 'ssh:host-1@@remote-pty',
      cwd: '',
      hostHint: 'inner.example',
      nestedSsh: true
    })
    expect(getCwdMock).not.toHaveBeenCalled()
  })

  it('returns to the outer cwd after the nested SSH process exits', async () => {
    getTerminalLocationMock
      .mockResolvedValueOnce({
        status: 'available',
        probe: {
          incarnationId: 'relay-1',
          foreground: { kind: 'ssh', epoch: '42:10', targetHint: 'inner.example' },
          outerCwd: '/root',
          nestedLocation: {
            cwd: '/home/test',
            host: 'inner.example',
            source: 'title',
            outputSeq: 3
          }
        }
      })
      .mockResolvedValue({
        status: 'available',
        probe: {
          incarnationId: 'relay-1',
          foreground: { kind: 'shell', epoch: '41:8', targetHint: null },
          outerCwd: '/srv/outer',
          nestedLocation: null
        }
      })
    const targets = [{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty', priority: true }]
    const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))
    await act(flushPromises)
    expect(result.current['ssh-tab']?.nestedSsh).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await flushPromises()
    })

    expect(result.current['ssh-tab']).toEqual({
      ptyId: 'ssh:host-1@@remote-pty',
      cwd: '/srv/outer',
      hostHint: null,
      nestedSsh: false
    })
  })

  it('keeps one unavailable sample, then replaces the nested location with honest unknown', async () => {
    getTerminalLocationMock
      .mockResolvedValueOnce({
        status: 'available',
        probe: {
          incarnationId: 'relay-1',
          foreground: { kind: 'ssh', epoch: '42:10', targetHint: 'inner.example' },
          outerCwd: '/root',
          nestedLocation: {
            cwd: '/home/test',
            host: 'inner.example',
            source: 'osc7',
            outputSeq: 3
          }
        }
      })
      .mockResolvedValue({ status: 'unavailable' })
    getCwdMock.mockResolvedValue('/root')
    const targets = [{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty', priority: true }]
    const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))
    await act(flushPromises)

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await flushPromises()
    })

    expect(result.current['ssh-tab']).toEqual({
      ptyId: 'ssh:host-1@@remote-pty',
      cwd: '/home/test',
      hostHint: 'inner.example',
      nestedSsh: true
    })
    expect(getCwdMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await flushPromises()
    })

    expect(result.current['ssh-tab']).toEqual({
      ptyId: 'ssh:host-1@@remote-pty',
      cwd: '',
      hostHint: null,
      nestedSsh: true
    })
  })

  it('falls back to the legacy cwd call when the structured probe is unsupported', async () => {
    getTerminalLocationMock.mockResolvedValue({ status: 'unsupported' })
    getCwdMock.mockResolvedValue('/srv/legacy')
    const targets = [{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty' }]
    const { result } = renderHook(() => useTerminalManagerSessionCwds(targets))

    await act(flushPromises)

    expect(result.current['ssh-tab']?.cwd).toBe('/srv/legacy')
    expect(getTerminalLocationMock).toHaveBeenCalledWith('ssh:host-1@@remote-pty')
    expect(getCwdMock).toHaveBeenCalledWith('ssh:host-1@@remote-pty')
  })

  it('does not start a legacy read for an unsupported response from an old generation', async () => {
    let resolveOld: (result: PtyTerminalLocationReadResult) => void = () => undefined
    getTerminalLocationMock
      .mockImplementationOnce(
        () =>
          new Promise<PtyTerminalLocationReadResult>((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValue({ status: 'unavailable' })
    const ptyId = 'ssh:host-1@@remote-pty'
    const view = renderHook(
      ({ connectionGeneration }) =>
        useTerminalManagerSessionCwds([
          { tabId: 'ssh-tab', ptyId, connectionGeneration, priority: true }
        ]),
      { initialProps: { connectionGeneration: 1 } }
    )

    view.rerender({ connectionGeneration: 2 })
    await act(flushPromises)
    await act(async () => {
      resolveOld({ status: 'unsupported' })
      await flushPromises()
    })

    expect(getCwdMock).not.toHaveBeenCalled()
  })

  it('fences a delayed response when the same SSH PTY id gets a new generation', async () => {
    let resolveOld: (result: PtyTerminalLocationReadResult) => void = () => undefined
    getTerminalLocationMock
      .mockImplementationOnce(
        () =>
          new Promise<PtyTerminalLocationReadResult>((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValue({
        status: 'available',
        probe: {
          incarnationId: 'relay-new',
          foreground: { kind: 'ssh', epoch: 'new', targetHint: 'new-host' },
          outerCwd: '/root',
          nestedLocation: {
            cwd: '/new/path',
            host: 'new-host',
            source: 'osc7',
            outputSeq: 1
          }
        }
      })
    const ptyId = 'ssh:host-1@@remote-pty'
    const view = renderHook(
      ({ connectionGeneration }) =>
        useTerminalManagerSessionCwds([
          { tabId: 'ssh-tab', ptyId, connectionGeneration, priority: true }
        ]),
      { initialProps: { connectionGeneration: 1 } }
    )

    view.rerender({ connectionGeneration: 2 })
    await act(flushPromises)
    expect(view.result.current['ssh-tab']).toMatchObject({
      connectionGeneration: 2,
      cwd: '/new/path',
      hostHint: 'new-host'
    })

    await act(async () => {
      resolveOld({
        status: 'available',
        probe: {
          incarnationId: 'relay-old',
          foreground: { kind: 'ssh', epoch: 'old', targetHint: 'old-host' },
          outerCwd: '/root',
          nestedLocation: {
            cwd: '/old/path',
            host: 'old-host',
            source: 'title',
            outputSeq: 1
          }
        }
      })
      await flushPromises()
    })

    expect(view.result.current['ssh-tab']).toMatchObject({
      connectionGeneration: 2,
      cwd: '/new/path',
      hostHint: 'new-host'
    })
  })

  it('keeps a hostless nested SSH state hostless', async () => {
    getTerminalLocationMock.mockResolvedValue({
      status: 'available',
      probe: {
        incarnationId: 'relay-1',
        foreground: { kind: 'ssh', epoch: '42:10', targetHint: null },
        outerCwd: '/root',
        nestedLocation: null
      }
    })
    const { result } = renderHook(() =>
      useTerminalManagerSessionCwds([{ tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty' }])
    )

    await act(flushPromises)
    expect(result.current['ssh-tab']?.hostHint).toBeNull()
    expect(result.current['ssh-tab']?.cwd).toBe('')
  })

  it('fast-polls a nonpriority nested SSH row and observes its exit', async () => {
    getTerminalLocationMock
      .mockResolvedValueOnce({
        status: 'available',
        probe: {
          incarnationId: 'relay-1',
          foreground: { kind: 'ssh', epoch: '42:10', targetHint: 'inner' },
          outerCwd: '/root',
          nestedLocation: { cwd: '/inner', host: 'inner', source: 'title', outputSeq: 1 }
        }
      })
      .mockResolvedValue({
        status: 'available',
        probe: {
          incarnationId: 'relay-1',
          foreground: { kind: 'shell', epoch: '41:8', targetHint: null },
          outerCwd: '/outer',
          nestedLocation: null
        }
      })
    const { result } = renderHook(() =>
      useTerminalManagerSessionCwds([
        { tabId: 'ssh-tab', ptyId: 'ssh:host-1@@remote-pty', priority: false }
      ])
    )
    await act(flushPromises)
    expect(result.current['ssh-tab']?.cwd).toBe('/inner')

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await flushPromises()
    })

    expect(result.current['ssh-tab']?.cwd).toBe('/outer')
    expect(result.current['ssh-tab']?.nestedSsh).toBe(false)
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
    await act(flushPromises)
    expect(view.result.current['ssh-tab']).toBeUndefined()
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
