import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { translate } from '@/i18n/i18n'
import {
  normalizeRuntimePathForComparison,
  resolveRuntimePath
} from '../../../../shared/cross-platform-path'

type RemoteBrowserState = {
  ownerKey: string
  currentPath: string
  pathValue: string
}

type UseRemoteFileBrowserParams = {
  enabled: boolean
  workspaceId: string | null
  homePath: string | null
  connectionId: string | null
  connectionGeneration?: number
}

type UseRemoteFileBrowserResult = {
  currentPath: string | null
  pathValue: string
  isNavigating: boolean
  canNavigateUp: boolean
  canNavigateHome: boolean
  setPathValue: (value: string) => void
  navigatePath: (path: string) => Promise<void>
  navigateKnownDirectory: (path: string) => void
  navigateUp: () => void
  navigateHome: () => void
}

function getOwnerKey(
  workspaceId: string | null,
  homePath: string | null,
  connectionId: string | null,
  connectionGeneration: number | undefined
): string {
  return `${workspaceId ?? ''}\u0000${homePath ?? ''}\u0000${connectionId ?? ''}\u0000${connectionGeneration ?? ''}`
}

export function useRemoteFileBrowser({
  enabled,
  workspaceId,
  homePath,
  connectionId,
  connectionGeneration
}: UseRemoteFileBrowserParams): UseRemoteFileBrowserResult {
  const ownerKey = getOwnerKey(workspaceId, homePath, connectionId, connectionGeneration)
  const [state, setState] = useState<RemoteBrowserState | null>(null)
  const [navigatingOwnerKey, setNavigatingOwnerKey] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const ownerKeyRef = useRef(ownerKey)
  useLayoutEffect(() => {
    // Why: invalidate an in-flight stat before a newly selected server can
    // inherit its result. A layout effect closes the post-commit window
    // without mutating refs during render.
    ownerKeyRef.current = ownerKey
    requestIdRef.current += 1
    setNavigatingOwnerKey(null)
  }, [ownerKey])
  const currentPath =
    enabled && homePath ? (state?.ownerKey === ownerKey ? state.currentPath : homePath) : homePath
  const pathValue = state?.ownerKey === ownerKey ? state.pathValue : (homePath ?? '')
  const isNavigating = navigatingOwnerKey === ownerKey

  const commitPath = useCallback(
    (path: string) => {
      setState({ ownerKey, currentPath: path, pathValue: path })
    },
    [ownerKey]
  )

  const setPathValue = useCallback(
    (value: string) => {
      if (!currentPath) {
        return
      }
      setState({ ownerKey, currentPath, pathValue: value })
    },
    [currentPath, ownerKey]
  )

  const navigatePath = useCallback(
    async (requestedPath: string) => {
      if (!enabled || !homePath || !currentPath) {
        return
      }
      const candidate = resolveRuntimePath(currentPath, requestedPath)

      const requestId = ++requestIdRef.current
      setNavigatingOwnerKey(ownerKey)
      try {
        if (!connectionId) {
          return
        }
        const result = await window.api.fs.stat({ filePath: candidate, connectionId })
        if (!result.isDirectory) {
          throw new Error(
            translate(
              'auto.components.right.sidebar.useRemoteFileBrowser.notFolder',
              'The remote path is not a folder.'
            )
          )
        }
        if (requestId === requestIdRef.current && ownerKeyRef.current === ownerKey) {
          commitPath(candidate)
        }
      } catch (error) {
        if (requestId === requestIdRef.current && ownerKeyRef.current === ownerKey) {
          toast.error(
            extractIpcErrorMessage(
              error,
              translate(
                'auto.components.right.sidebar.useRemoteFileBrowser.openFailed',
                'Could not open the remote folder.'
              )
            )
          )
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setNavigatingOwnerKey((current) => (current === ownerKey ? null : current))
        }
      }
    },
    [commitPath, connectionId, currentPath, enabled, homePath, ownerKey]
  )

  const navigateHome = useCallback(() => {
    if (homePath) {
      requestIdRef.current += 1
      setNavigatingOwnerKey(null)
      commitPath(homePath)
    }
  }, [commitPath, homePath])

  const navigateKnownDirectory = useCallback(
    (path: string) => {
      if (!homePath) {
        return
      }
      requestIdRef.current += 1
      setNavigatingOwnerKey(null)
      commitPath(resolveRuntimePath(homePath, path))
    },
    [commitPath, homePath]
  )

  const navigateUp = useCallback(() => {
    if (!homePath || !currentPath) {
      return
    }
    const parentPath = resolveRuntimePath(currentPath, '..')
    if (
      normalizeRuntimePathForComparison(parentPath) !==
      normalizeRuntimePathForComparison(currentPath)
    ) {
      requestIdRef.current += 1
      setNavigatingOwnerKey(null)
      commitPath(parentPath)
    }
  }, [commitPath, currentPath, homePath])

  return {
    currentPath,
    pathValue,
    isNavigating,
    canNavigateUp: Boolean(
      enabled &&
      currentPath &&
      normalizeRuntimePathForComparison(resolveRuntimePath(currentPath, '..')) !==
        normalizeRuntimePathForComparison(currentPath)
    ),
    canNavigateHome: Boolean(
      enabled &&
      homePath &&
      currentPath &&
      normalizeRuntimePathForComparison(homePath) !== normalizeRuntimePathForComparison(currentPath)
    ),
    setPathValue,
    navigatePath,
    navigateKnownDirectory,
    navigateUp,
    navigateHome
  }
}
