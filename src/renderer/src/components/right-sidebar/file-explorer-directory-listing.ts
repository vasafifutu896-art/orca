import { joinPath, normalizeRelativePath } from '@/lib/path'
import type { DirEntry } from '../../../../shared/filesystem-entry-types'
import { sortDirEntries } from '../../../../shared/file-name-sort'
import { readRuntimeDirectory } from '@/runtime/runtime-file-client'
import type { FileExplorerOperationOwner, TreeNode } from './file-explorer-types'
import { shouldIncludeFileExplorerEntry } from './file-explorer-entries'
import {
  getFileExplorerOperationOwner,
  getFileExplorerOwnerUnresolvedMessage,
  getFileExplorerOperationRoute
} from './file-explorer-operation-owner'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'

export type FileExplorerDirectoryListing = {
  entries: DirEntry[]
  operationOwner: FileExplorerOperationOwner
}

export function fileExplorerEntriesToTreeNodes(
  entries: DirEntry[],
  dirPath: string,
  depth: number,
  worktreePath: string | null,
  operationOwner: FileExplorerOperationOwner
): TreeNode[] {
  return entries.filter(shouldIncludeFileExplorerEntry).map((entry) => {
    const path = joinPath(dirPath, entry.name)
    const relativePath = worktreePath ? relativePathInsideRoot(worktreePath, path) : null
    return {
      name: entry.name,
      path,
      // Why: direct SSH browsing can move above Home like MobaXterm. Keep a
      // workspace-relative key inside Home, but use the absolute remote path
      // outside it instead of fabricating a sliced prefix.
      relativePath: relativePath === null ? path : normalizeRelativePath(relativePath),
      isDirectory: entry.isDirectory,
      isSymlink: entry.isSymlink,
      depth: depth + 1,
      operationOwner
    }
  })
}

export async function readFileExplorerDirectory(
  activeWorktreeId: string | null | undefined,
  worktreePath: string | null,
  dirPath: string
): Promise<FileExplorerDirectoryListing> {
  const operationOwner = getFileExplorerOperationOwner(activeWorktreeId)
  const route = getFileExplorerOperationRoute(operationOwner)
  if (!route) {
    throw new Error(getFileExplorerOwnerUnresolvedMessage())
  }
  const entries = await readRuntimeDirectory(
    {
      settings: route.settings,
      worktreeId: activeWorktreeId,
      worktreePath,
      connectionId: route.connectionId
    },
    dirPath
  )
  // Why: remote-runtime and paired-web routes return the host's order verbatim,
  // and an older host may still sort lexicographically; re-sorting an already
  // sorted local listing is near-free (adaptive sort).
  return { entries: sortDirEntries(entries), operationOwner }
}
