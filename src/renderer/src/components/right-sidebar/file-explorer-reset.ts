import type { RightSidebarExplorerView } from '../../../../shared/ui-chrome-types'

export function getVisibleFileExplorerWorktreePath({
  explorerView,
  rightSidebarOpen,
  worktreePath
}: {
  explorerView: RightSidebarExplorerView
  rightSidebarOpen: boolean
  worktreePath: string | null
}): string | null {
  // Why: Contents search keeps the file pane mounted, but hidden file trees
  // must not trigger passive file loads or macOS app-data probes.
  return rightSidebarOpen && explorerView === 'files' ? worktreePath : null
}

export function shouldResetFileExplorerForVisibleWorktree(
  lastResetWorktreePath: string | null,
  visibleWorktreePath: string | null
): visibleWorktreePath is string {
  return visibleWorktreePath !== null && lastResetWorktreePath !== visibleWorktreePath
}

export function getFileExplorerResetIdentity({
  worktreeId,
  visibleRootPath,
  connectionId,
  connectionGeneration
}: {
  worktreeId: string | null
  visibleRootPath: string | null
  connectionId: string | null
  connectionGeneration?: number
}): string | null {
  if (!worktreeId || !visibleRootPath) {
    return null
  }
  // Why: two SSH workspaces commonly have the same Home path (for example
  // /root). A path-only reset key can then leak server A's cached listing and
  // operation owner into server B, making the first upload fail its owner guard.
  return [worktreeId, visibleRootPath, connectionId ?? 'local', connectionGeneration ?? ''].join(
    '\u0000'
  )
}

export function getFileExplorerVisibleExpandedDirs(
  expanded: Set<string>,
  flatRemoteBrowser: boolean
): Set<string> {
  // Why: the Moba-style remote view shows one directory at a time. Reusing
  // tree expansion state would make refresh/watch fan out hidden SSH reads.
  return flatRemoteBrowser ? new Set<string>() : expanded
}
