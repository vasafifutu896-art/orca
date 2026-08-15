// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastErrorMock = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock }
}))

import { useRemoteFileBrowser } from './useRemoteFileBrowser'

describe('useRemoteFileBrowser', () => {
  const stat = vi.fn()

  beforeEach(() => {
    stat.mockReset()
    toastErrorMock.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { fs: { stat } }
    })
  })

  it('opens known folders immediately and supports parent and Home navigation', () => {
    const { result } = renderHook(() =>
      useRemoteFileBrowser({
        enabled: true,
        workspaceId: 'folder:one',
        homePath: '/home/dev',
        connectionId: 'ssh-1'
      })
    )

    expect(result.current.currentPath).toBe('/home/dev')
    expect(result.current.canNavigateUp).toBe(true)
    expect(result.current.canNavigateHome).toBe(false)

    act(() => result.current.navigateKnownDirectory('/home/dev/projects'))
    expect(result.current.currentPath).toBe('/home/dev/projects')
    expect(result.current.canNavigateUp).toBe(true)
    expect(result.current.canNavigateHome).toBe(true)

    act(() => result.current.navigateUp())
    expect(result.current.currentPath).toBe('/home/dev')

    act(() => result.current.navigateUp())
    expect(result.current.currentPath).toBe('/home')
    expect(result.current.canNavigateHome).toBe(true)
    act(() => result.current.navigateHome())
    expect(result.current.currentPath).toBe('/home/dev')

    act(() => result.current.navigateKnownDirectory('/home/dev/projects/app'))
    act(() => result.current.navigateHome())
    expect(result.current.currentPath).toBe('/home/dev')
    expect(stat).not.toHaveBeenCalled()
  })

  it('validates typed folders on the owning SSH connection', async () => {
    stat.mockResolvedValue({ size: 0, isDirectory: true, mtime: 0 })
    const { result } = renderHook(() =>
      useRemoteFileBrowser({
        enabled: true,
        workspaceId: 'folder:one',
        homePath: '/home/dev',
        connectionId: 'ssh-1'
      })
    )

    await act(() => result.current.navigatePath('projects'))

    expect(stat).toHaveBeenCalledWith({
      filePath: '/home/dev/projects',
      connectionId: 'ssh-1'
    })
    expect(result.current.currentPath).toBe('/home/dev/projects')
    expect(result.current.pathValue).toBe('/home/dev/projects')
  })

  it('can browse and return from server folders above SSH Home', async () => {
    stat.mockResolvedValue({ size: 0, isDirectory: true, mtime: 0 })
    const { result } = renderHook(() =>
      useRemoteFileBrowser({
        enabled: true,
        workspaceId: 'folder:one',
        homePath: '/home/dev',
        connectionId: 'ssh-1'
      })
    )

    await act(() => result.current.navigatePath('/etc'))

    expect(stat).toHaveBeenCalledWith({ filePath: '/etc', connectionId: 'ssh-1' })
    expect(result.current.currentPath).toBe('/etc')

    act(() => result.current.navigateHome())
    expect(result.current.currentPath).toBe('/home/dev')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('resets the visible location when the active SSH workspace changes', () => {
    const { result, rerender } = renderHook(
      ({ workspaceId, homePath }) =>
        useRemoteFileBrowser({
          enabled: true,
          workspaceId,
          homePath,
          connectionId: 'ssh-1'
        }),
      { initialProps: { workspaceId: 'folder:one', homePath: '/home/dev' } }
    )
    act(() => result.current.navigateKnownDirectory('/home/dev/projects'))

    rerender({ workspaceId: 'folder:two', homePath: '/srv/build' })

    expect(result.current.currentPath).toBe('/srv/build')
    expect(result.current.pathValue).toBe('/srv/build')
  })

  it('resets when another SSH workspace has the same Home path', () => {
    const { result, rerender } = renderHook(
      ({ workspaceId, connectionId }) =>
        useRemoteFileBrowser({
          enabled: true,
          workspaceId,
          homePath: '/root',
          connectionId
        }),
      { initialProps: { workspaceId: 'folder:one', connectionId: 'ssh-1' } }
    )
    act(() => result.current.navigateKnownDirectory('/var/log'))

    rerender({ workspaceId: 'folder:two', connectionId: 'ssh-2' })

    expect(result.current.currentPath).toBe('/root')
    expect(result.current.pathValue).toBe('/root')
  })

  it('does not commit a typed navigation after the owning SSH workspace changes', async () => {
    let resolveStat!: (value: { size: number; isDirectory: boolean; mtime: number }) => void
    stat.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStat = resolve
      })
    )
    const { result, rerender } = renderHook(
      ({ workspaceId, connectionId }) =>
        useRemoteFileBrowser({
          enabled: true,
          workspaceId,
          homePath: '/root',
          connectionId
        }),
      { initialProps: { workspaceId: 'folder:one', connectionId: 'ssh-1' } }
    )

    let navigation!: Promise<void>
    act(() => {
      navigation = result.current.navigatePath('/etc')
    })
    rerender({ workspaceId: 'folder:two', connectionId: 'ssh-2' })
    await act(async () => {
      resolveStat({ size: 0, isDirectory: true, mtime: 0 })
      await navigation
    })

    expect(result.current.currentPath).toBe('/root')
    expect(result.current.pathValue).toBe('/root')
  })

  it('does not commit a typed navigation after the same SSH target reconnects', async () => {
    let resolveStat!: (value: { size: number; isDirectory: boolean; mtime: number }) => void
    stat.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStat = resolve
      })
    )
    const { result, rerender } = renderHook(
      ({ connectionGeneration }) =>
        useRemoteFileBrowser({
          enabled: true,
          workspaceId: 'folder:one',
          homePath: '/root',
          connectionId: 'ssh-1',
          connectionGeneration
        }),
      { initialProps: { connectionGeneration: 1 } }
    )

    let navigation!: Promise<void>
    act(() => {
      navigation = result.current.navigatePath('/etc')
    })
    rerender({ connectionGeneration: 2 })
    await act(async () => {
      resolveStat({ size: 0, isDirectory: true, mtime: 0 })
      await navigation
    })

    expect(result.current.currentPath).toBe('/root')
    expect(result.current.pathValue).toBe('/root')
  })

  it('does not show a stale navigation error after switching SSH workspaces', async () => {
    let rejectStat!: (error: Error) => void
    stat.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectStat = reject
      })
    )
    const { result, rerender } = renderHook(
      ({ workspaceId, connectionId }) =>
        useRemoteFileBrowser({
          enabled: true,
          workspaceId,
          homePath: '/root',
          connectionId
        }),
      { initialProps: { workspaceId: 'folder:one', connectionId: 'ssh-1' } }
    )

    let navigation!: Promise<void>
    act(() => {
      navigation = result.current.navigatePath('/etc')
    })
    rerender({ workspaceId: 'folder:two', connectionId: 'ssh-2' })
    await act(async () => {
      rejectStat(new Error('server A disconnected'))
      await navigation
    })

    expect(toastErrorMock).not.toHaveBeenCalled()
  })
})
