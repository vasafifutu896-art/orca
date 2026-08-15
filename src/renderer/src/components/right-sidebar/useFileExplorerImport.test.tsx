// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeFileDropPayload } from '../../../../shared/native-file-drop'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { useAppStore } from '@/store'
import { getFileExplorerOperationSnapshotFromState } from './file-explorer-operation-owner'

const {
  importExternalPathsToRuntimeMock,
  pickDirectoryMock,
  pickFilesMock,
  toastErrorMock,
  toastSuccessMock
} = vi.hoisted(() => ({
  importExternalPathsToRuntimeMock: vi.fn(),
  pickDirectoryMock: vi.fn(),
  pickFilesMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn()
}))

vi.mock('@/runtime/runtime-file-client', () => ({
  importExternalPathsToRuntime: importExternalPathsToRuntimeMock
}))

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock }
}))

import { useFileExplorerImport } from './useFileExplorerImport'

const initialState = useAppStore.getInitialState()

function getCurrentOwnerSnapshot(worktreeId: string): string {
  return getFileExplorerOperationSnapshotFromState(useAppStore.getState(), worktreeId) as string
}

describe('useFileExplorerImport', () => {
  let fileDropHandler: ((payload: NativeFileDropPayload) => void) | null

  function configureConnectedFolderWorkspace(): string {
    const folderWorkspaceId = 'folder-1'
    const worktreeId = folderWorkspaceKey(folderWorkspaceId)
    useAppStore.setState({
      folderWorkspaces: [
        {
          id: folderWorkspaceId,
          projectGroupId: 'group-1',
          folderPath: '/home/dev',
          connectionId: 'client-target'
        } as never
      ],
      projectGroups: [{ id: 'group-1', connectionId: 'client-target' } as never],
      repos: [],
      worktreesByRepo: {}
    })
    useAppStore.getState().setSshConnectionState('client-target', {
      targetId: 'client-target',
      status: 'connected',
      error: null,
      reconnectAttempt: 0,
      connectionGeneration: 7
    })
    return worktreeId
  }

  beforeEach(() => {
    fileDropHandler = null
    importExternalPathsToRuntimeMock.mockReset()
    toastErrorMock.mockReset()
    toastSuccessMock.mockReset()
    pickFilesMock.mockReset().mockResolvedValue([])
    pickDirectoryMock.mockReset().mockResolvedValue(null)
    importExternalPathsToRuntimeMock.mockResolvedValue({
      results: [
        {
          sourcePath: 'C:\\Users\\dev\\notes.txt',
          status: 'imported',
          destPath: '/home/dev/notes.txt',
          kind: 'file',
          renamed: false
        }
      ]
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ui: {
          onFileDrop: vi.fn((handler: (payload: NativeFileDropPayload) => void) => {
            fileDropHandler = handler
            return vi.fn()
          })
        },
        shell: {
          pickFiles: pickFilesMock,
          pickDirectory: pickDirectoryMock
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    useAppStore.getState().setRuntimeEnvironments([])
    useAppStore.setState(initialState, true)
  })

  it('uses the live SSH Home owner when the initial directory cache has no owner yet', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    const ownerSnapshot = getCurrentOwnerSnapshot(worktreeId)

    const refreshDir = vi.fn(async () => {})
    const clearNativeDragState = vi.fn()
    const setSelectedPath = vi.fn()
    renderHook(() =>
      useFileExplorerImport({
        worktreePath: '/home/dev',
        activeWorktreeId: worktreeId,
        refreshDir,
        clearNativeDragState,
        setSelectedPath,
        operationOwner: undefined
      })
    )
    expect(fileDropHandler).not.toBeNull()

    act(() => {
      fileDropHandler?.({
        target: 'file-explorer',
        paths: ['C:\\Users\\dev\\notes.txt'],
        destinationDir: '/home/dev',
        workspaceId: worktreeId,
        workspaceRootPath: '/home/dev',
        ownerSnapshot
      })
    })

    await waitFor(() => expect(importExternalPathsToRuntimeMock).toHaveBeenCalledOnce())
    expect(importExternalPathsToRuntimeMock).toHaveBeenCalledWith(
      {
        settings: { activeRuntimeEnvironmentId: null },
        worktreeId,
        worktreePath: '/home/dev',
        connectionId: 'client-target',
        expectedExecutionHostId: 'ssh:client-target',
        expectedSshTargetId: 'client-target',
        expectedSshConnectionGeneration: 7
      },
      ['C:\\Users\\dev\\notes.txt'],
      '/home/dev',
      { assertCurrent: expect.any(Function) }
    )
    await waitFor(() => expect(refreshDir).toHaveBeenCalledWith('/home/dev'))
    expect(setSelectedPath).toHaveBeenCalledWith('/home/dev/notes.txt')
    expect(clearNativeDragState).toHaveBeenCalledOnce()
  })

  it('uploads a picked file batch through the same guarded SSH import path', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    pickFilesMock.mockResolvedValueOnce(['C:\\Users\\dev\\a.txt', 'C:\\Users\\dev\\b.txt'])
    importExternalPathsToRuntimeMock.mockResolvedValueOnce({
      results: [
        {
          sourcePath: 'C:\\Users\\dev\\a.txt',
          status: 'imported',
          destPath: '/home/dev/releases/a.txt',
          kind: 'file',
          renamed: false
        },
        {
          sourcePath: 'C:\\Users\\dev\\b.txt',
          status: 'imported',
          destPath: '/home/dev/releases/b.txt',
          kind: 'file',
          renamed: false
        }
      ]
    })
    const refreshDir = vi.fn(async () => {})
    const setSelectedPath = vi.fn()
    const hook = renderHook(() =>
      useFileExplorerImport({
        worktreePath: '/home/dev',
        activeWorktreeId: worktreeId,
        refreshDir,
        clearNativeDragState: vi.fn(),
        setSelectedPath,
        operationOwner: undefined
      })
    )

    await act(() => hook.result.current.uploadFiles('/home/dev/releases'))

    expect(importExternalPathsToRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId,
        worktreePath: '/home/dev',
        connectionId: 'client-target',
        expectedSshConnectionGeneration: 7
      }),
      ['C:\\Users\\dev\\a.txt', 'C:\\Users\\dev\\b.txt'],
      '/home/dev/releases',
      { assertCurrent: expect.any(Function) }
    )
    expect(refreshDir).toHaveBeenCalledWith('/home/dev/releases')
    expect(setSelectedPath).toHaveBeenCalledWith('/home/dev/releases/a.txt')
    expect(toastSuccessMock).toHaveBeenCalledWith('Uploaded 2 item(s).')
    expect(hook.result.current.uploadAction).toBeNull()
  })

  it('reports skipped picker items alongside successful uploads', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    pickFilesMock.mockResolvedValueOnce(['C:\\Users\\dev\\a.txt', 'C:\\Users\\dev\\missing.txt'])
    importExternalPathsToRuntimeMock.mockResolvedValueOnce({
      results: [
        {
          sourcePath: 'C:\\Users\\dev\\a.txt',
          status: 'imported',
          destPath: '/home/dev/a.txt',
          kind: 'file',
          renamed: false
        },
        {
          sourcePath: 'C:\\Users\\dev\\missing.txt',
          status: 'skipped',
          reason: 'missing'
        }
      ]
    })
    const hook = renderHook(() =>
      useFileExplorerImport({
        worktreePath: '/home/dev',
        activeWorktreeId: worktreeId,
        refreshDir: vi.fn(async () => {}),
        clearNativeDragState: vi.fn(),
        setSelectedPath: vi.fn(),
        operationOwner: undefined
      })
    )

    await act(() => hook.result.current.uploadFiles('/home/dev'))

    expect(toastSuccessMock).toHaveBeenCalledWith('Uploaded 1 item(s).')
    expect(toastErrorMock).toHaveBeenCalledWith('Skipped 1 item.')
  })

  it('reports both failed and skipped items from the same upload batch', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    pickFilesMock.mockResolvedValueOnce([
      'C:\\Users\\dev\\blocked.txt',
      'C:\\Users\\dev\\missing.txt'
    ])
    importExternalPathsToRuntimeMock.mockResolvedValueOnce({
      results: [
        {
          sourcePath: 'C:\\Users\\dev\\blocked.txt',
          status: 'failed',
          reason: 'permission denied'
        },
        {
          sourcePath: 'C:\\Users\\dev\\missing.txt',
          status: 'skipped',
          reason: 'missing'
        }
      ]
    })
    const hook = renderHook(() =>
      useFileExplorerImport({
        worktreePath: '/home/dev',
        activeWorktreeId: worktreeId,
        refreshDir: vi.fn(async () => {}),
        clearNativeDragState: vi.fn(),
        setSelectedPath: vi.fn(),
        operationOwner: undefined
      })
    )

    await act(() => hook.result.current.uploadFiles('/home/dev'))

    expect(toastErrorMock).toHaveBeenCalledWith('Failed to upload 1 item.')
    expect(toastErrorMock).toHaveBeenCalledWith('Skipped 1 item.')
  })

  it('uploads a folder selected by the native directory picker', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    pickDirectoryMock.mockResolvedValueOnce('C:\\Users\\dev\\assets')
    importExternalPathsToRuntimeMock.mockResolvedValueOnce({
      results: [
        {
          sourcePath: 'C:\\Users\\dev\\assets',
          status: 'imported',
          destPath: '/home/dev/assets',
          kind: 'directory',
          renamed: false
        }
      ]
    })
    const hook = renderHook(() =>
      useFileExplorerImport({
        worktreePath: '/home/dev',
        activeWorktreeId: worktreeId,
        refreshDir: vi.fn(async () => {}),
        clearNativeDragState: vi.fn(),
        setSelectedPath: vi.fn(),
        operationOwner: undefined
      })
    )

    await act(() => hook.result.current.uploadFolder('/home/dev'))

    expect(pickDirectoryMock).toHaveBeenCalledWith({})
    expect(importExternalPathsToRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'client-target' }),
      ['C:\\Users\\dev\\assets'],
      '/home/dev',
      { assertCurrent: expect.any(Function) }
    )
    expect(toastSuccessMock).toHaveBeenCalledWith('Uploaded 1 item(s).')
  })

  it('does not upload picker results after the active workspace changes', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    let resolvePicker!: (paths: string[]) => void
    pickFilesMock.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        resolvePicker = resolve
      })
    )
    const hook = renderHook(
      ({ activeId, rootPath }) =>
        useFileExplorerImport({
          worktreePath: rootPath,
          activeWorktreeId: activeId,
          refreshDir: vi.fn(async () => {}),
          clearNativeDragState: vi.fn(),
          setSelectedPath: vi.fn(),
          operationOwner: undefined
        }),
      { initialProps: { activeId: worktreeId, rootPath: '/home/dev' } }
    )

    let uploadPromise!: Promise<void>
    act(() => {
      uploadPromise = hook.result.current.uploadFiles('/home/dev')
    })
    hook.rerender({ activeId: 'folder:other', rootPath: '/srv/other' })
    await act(async () => {
      resolvePicker(['C:\\Users\\dev\\notes.txt'])
      await uploadPromise
    })

    expect(importExternalPathsToRuntimeMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledWith(
      'The active workspace changed while selecting files.'
    )
  })

  it('does not route a native drop to a workspace selected after the gesture', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    const ownerSnapshot = getCurrentOwnerSnapshot(worktreeId)
    const hook = renderHook(
      ({ activeId, rootPath }) =>
        useFileExplorerImport({
          worktreePath: rootPath,
          activeWorktreeId: activeId,
          refreshDir: vi.fn(async () => {}),
          clearNativeDragState: vi.fn(),
          setSelectedPath: vi.fn(),
          operationOwner: undefined
        }),
      { initialProps: { activeId: worktreeId, rootPath: '/home/dev' } }
    )
    const dropFromServerA: NativeFileDropPayload = {
      target: 'file-explorer',
      paths: ['C:\\Users\\dev\\notes.txt'],
      destinationDir: '/home/dev',
      workspaceId: worktreeId,
      workspaceRootPath: '/home/dev',
      ownerSnapshot
    }

    hook.rerender({ activeId: 'folder:server-b', rootPath: '/root' })
    act(() => {
      fileDropHandler?.(dropFromServerA)
    })

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce())
    expect(importExternalPathsToRuntimeMock).not.toHaveBeenCalled()
  })

  it('does not route a native drop after the same workspace root changes', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    const ownerSnapshot = getCurrentOwnerSnapshot(worktreeId)
    const hook = renderHook(
      ({ rootPath }) =>
        useFileExplorerImport({
          worktreePath: rootPath,
          activeWorktreeId: worktreeId,
          refreshDir: vi.fn(async () => {}),
          clearNativeDragState: vi.fn(),
          setSelectedPath: vi.fn(),
          operationOwner: undefined
        }),
      { initialProps: { rootPath: '/home/dev' } }
    )

    hook.rerender({ rootPath: '/srv/replacement' })
    act(() => {
      fileDropHandler?.({
        target: 'file-explorer',
        paths: ['C:\\Users\\dev\\notes.txt'],
        destinationDir: '/home/dev',
        workspaceId: worktreeId,
        workspaceRootPath: '/home/dev',
        ownerSnapshot
      })
    })

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce())
    expect(importExternalPathsToRuntimeMock).not.toHaveBeenCalled()
  })

  it('does not route a native drop across an SSH reconnection generation', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    const ownerSnapshot = getCurrentOwnerSnapshot(worktreeId)
    renderHook(() =>
      useFileExplorerImport({
        worktreePath: '/home/dev',
        activeWorktreeId: worktreeId,
        refreshDir: vi.fn(async () => {}),
        clearNativeDragState: vi.fn(),
        setSelectedPath: vi.fn(),
        operationOwner: undefined
      })
    )
    useAppStore.getState().setSshConnectionState('client-target', {
      targetId: 'client-target',
      status: 'connected',
      error: null,
      reconnectAttempt: 0,
      connectionGeneration: 8
    })

    act(() => {
      fileDropHandler?.({
        target: 'file-explorer',
        paths: ['C:\\Users\\dev\\notes.txt'],
        destinationDir: '/home/dev',
        workspaceId: worktreeId,
        workspaceRootPath: '/home/dev',
        ownerSnapshot
      })
    })

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledOnce())
    expect(importExternalPathsToRuntimeMock).not.toHaveBeenCalled()
  })

  it('reports a reconnect failure before refreshing the replacement SSH session', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    pickFilesMock.mockResolvedValueOnce(['C:\\Users\\dev\\notes.txt'])
    importExternalPathsToRuntimeMock.mockImplementationOnce(async () => {
      useAppStore.getState().setSshConnectionState('client-target', {
        targetId: 'client-target',
        status: 'connected',
        error: null,
        reconnectAttempt: 0,
        connectionGeneration: 8
      })
      return {
        results: [
          {
            sourcePath: 'C:\\Users\\dev\\notes.txt',
            status: 'failed' as const,
            reason: 'SSH connection changed'
          }
        ]
      }
    })
    const refreshDir = vi.fn(async () => {})
    const hook = renderHook(() =>
      useFileExplorerImport({
        worktreePath: '/home/dev',
        activeWorktreeId: worktreeId,
        refreshDir,
        clearNativeDragState: vi.fn(),
        setSelectedPath: vi.fn(),
        operationOwner: undefined
      })
    )

    await act(() => hook.result.current.uploadFiles('/home/dev'))

    expect(refreshDir).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledWith(
      'The connection changed during the upload. Check the destination before trying again.'
    )
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })

  it('serializes native drops with picker uploads instead of running transfers in parallel', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    const ownerSnapshot = getCurrentOwnerSnapshot(worktreeId)
    let resolveImport!: (value: {
      results: {
        sourcePath: string
        status: 'imported'
        destPath: string
        kind: 'file'
        renamed: false
      }[]
    }) => void
    importExternalPathsToRuntimeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveImport = resolve
      })
    )
    const hook = renderHook(() =>
      useFileExplorerImport({
        worktreePath: '/home/dev',
        activeWorktreeId: worktreeId,
        refreshDir: vi.fn(async () => {}),
        clearNativeDragState: vi.fn(),
        setSelectedPath: vi.fn(),
        operationOwner: undefined
      })
    )
    const payload: NativeFileDropPayload = {
      target: 'file-explorer',
      paths: ['C:\\Users\\dev\\notes.txt'],
      destinationDir: '/home/dev',
      workspaceId: worktreeId,
      workspaceRootPath: '/home/dev',
      ownerSnapshot
    }

    act(() => fileDropHandler?.(payload))
    await waitFor(() => expect(importExternalPathsToRuntimeMock).toHaveBeenCalledOnce())
    expect(hook.result.current.uploadAction).toBe('files')
    act(() => fileDropHandler?.(payload))
    expect(importExternalPathsToRuntimeMock).toHaveBeenCalledOnce()
    expect(toastErrorMock).toHaveBeenCalledWith(
      'An upload is already in progress. Try again when it finishes.'
    )

    await act(async () => {
      resolveImport({
        results: [
          {
            sourcePath: 'C:\\Users\\dev\\notes.txt',
            status: 'imported',
            destPath: '/home/dev/notes.txt',
            kind: 'file',
            renamed: false
          }
        ]
      })
    })
    await waitFor(() => expect(hook.result.current.uploadAction).toBeNull())
  })

  it('does not select an old remote path when the workspace changes during refresh', async () => {
    const worktreeId = configureConnectedFolderWorkspace()
    pickFilesMock.mockResolvedValueOnce(['C:\\Users\\dev\\notes.txt'])
    let resolveRefresh!: () => void
    const refreshDir = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
    )
    const setSelectedPath = vi.fn()
    const hook = renderHook(
      ({ activeId, rootPath }) =>
        useFileExplorerImport({
          worktreePath: rootPath,
          activeWorktreeId: activeId,
          refreshDir,
          clearNativeDragState: vi.fn(),
          setSelectedPath,
          operationOwner: undefined
        }),
      { initialProps: { activeId: worktreeId, rootPath: '/home/dev' } }
    )

    let uploadPromise!: Promise<void>
    act(() => {
      uploadPromise = hook.result.current.uploadFiles('/home/dev')
    })
    await waitFor(() => expect(refreshDir).toHaveBeenCalledWith('/home/dev'))
    hook.rerender({ activeId: 'folder:other', rootPath: '/srv/other' })
    await act(async () => {
      resolveRefresh()
      await uploadPromise
    })

    expect(setSelectedPath).not.toHaveBeenCalled()
    expect(toastSuccessMock).not.toHaveBeenCalled()
  })
})
