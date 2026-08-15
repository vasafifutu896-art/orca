import { describe, expect, it } from 'vitest'
import {
  getFileExplorerResetIdentity,
  getFileExplorerVisibleExpandedDirs,
  getVisibleFileExplorerWorktreePath,
  shouldResetFileExplorerForVisibleWorktree
} from './file-explorer-reset'

describe('getVisibleFileExplorerWorktreePath', () => {
  it('exposes the worktree path only while the Files view is visible', () => {
    expect(
      getVisibleFileExplorerWorktreePath({
        explorerView: 'files',
        rightSidebarOpen: true,
        worktreePath: '/repo'
      })
    ).toBe('/repo')
    expect(
      getVisibleFileExplorerWorktreePath({
        explorerView: 'search',
        rightSidebarOpen: true,
        worktreePath: '/repo'
      })
    ).toBeNull()
    expect(
      getVisibleFileExplorerWorktreePath({
        explorerView: 'files',
        rightSidebarOpen: false,
        worktreePath: '/repo'
      })
    ).toBeNull()
  })
})

describe('shouldResetFileExplorerForVisibleWorktree', () => {
  it('preserves explorer state across hide and reopen of the same worktree', () => {
    let lastResetWorktreePath: string | null = null
    const shouldReset = (visibleWorktreePath: string | null): boolean => {
      if (shouldResetFileExplorerForVisibleWorktree(lastResetWorktreePath, visibleWorktreePath)) {
        lastResetWorktreePath = visibleWorktreePath
        return true
      }
      return false
    }

    expect(shouldReset(null)).toBe(false)
    expect(shouldReset('/repo')).toBe(true)
    expect(shouldReset(null)).toBe(false)
    expect(shouldReset('/repo')).toBe(false)
  })

  it('resets when the visible worktree path changes', () => {
    expect(shouldResetFileExplorerForVisibleWorktree('/repo', '/repo-next')).toBe(true)
  })
})

describe('getFileExplorerResetIdentity', () => {
  it('distinguishes SSH workspaces that share the same remote Home path', () => {
    const first = getFileExplorerResetIdentity({
      worktreeId: 'folder:first',
      visibleRootPath: '/root',
      connectionId: 'ssh-first',
      connectionGeneration: 3
    })
    const second = getFileExplorerResetIdentity({
      worktreeId: 'folder:second',
      visibleRootPath: '/root',
      connectionId: 'ssh-second',
      connectionGeneration: 1
    })

    expect(first).not.toBe(second)
  })

  it('changes after the owning SSH connection reconnects', () => {
    const before = getFileExplorerResetIdentity({
      worktreeId: 'folder:first',
      visibleRootPath: '/root',
      connectionId: 'ssh-first',
      connectionGeneration: 3
    })
    const after = getFileExplorerResetIdentity({
      worktreeId: 'folder:first',
      visibleRootPath: '/root',
      connectionId: 'ssh-first',
      connectionGeneration: 4
    })

    expect(before).not.toBe(after)
  })
})

describe('getFileExplorerVisibleExpandedDirs', () => {
  it('removes hidden tree expansions from the flat remote browser', () => {
    const expanded = new Set(['/root/src', '/root/packages'])

    expect(getFileExplorerVisibleExpandedDirs(expanded, true)).toEqual(new Set())
    expect(getFileExplorerVisibleExpandedDirs(expanded, false)).toBe(expanded)
  })
})
