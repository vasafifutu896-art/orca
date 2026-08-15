import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { importExternalPathsToRuntime } from '@/runtime/runtime-file-client'
import { translate } from '@/i18n/i18n'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import {
  captureFileExplorerOperationGuard,
  getFileExplorerOperationOwner
} from './file-explorer-operation-owner'

type UseFileExplorerImportParams = {
  worktreePath: string | null
  activeWorktreeId: string | null
  refreshDir: (dirPath: string) => Promise<void>
  clearNativeDragState: () => void
  setSelectedPath: (path: string | null) => void
  operationOwner?: FileExplorerOperationOwner
}

export type FileExplorerUploadAction = 'files' | 'folder' | null

type UseFileExplorerImportResult = {
  uploadAction: FileExplorerUploadAction
  uploadFiles: (destinationDir: string) => Promise<void>
  uploadFolder: (destinationDir: string) => Promise<void>
}

/**
 * Subscribes to native file-drop events targeted at the file explorer and
 * runs the import pipeline: copy into worktree, refresh, reveal.
 *
 * Why this is a separate hook: the actual filesystem paths from native OS
 * drops are only available through the preload-relayed IPC event, not the
 * React drop handler. The drop handler manages visual state; this hook
 * manages the import action.
 */
export function useFileExplorerImport({
  worktreePath,
  activeWorktreeId,
  refreshDir,
  clearNativeDragState,
  setSelectedPath,
  operationOwner
}: UseFileExplorerImportParams): UseFileExplorerImportResult {
  const [uploadAction, setUploadAction] = useState<FileExplorerUploadAction>(null)
  const uploadInProgressRef = useRef(false)
  // Refs to avoid re-subscribing IPC listener on every render
  const worktreePathRef = useRef(worktreePath)
  worktreePathRef.current = worktreePath
  const activeWorktreeIdRef = useRef(activeWorktreeId)
  activeWorktreeIdRef.current = activeWorktreeId
  const refreshDirRef = useRef(refreshDir)
  refreshDirRef.current = refreshDir
  const clearNativeDragStateRef = useRef(clearNativeDragState)
  clearNativeDragStateRef.current = clearNativeDragState
  const setSelectedPathRef = useRef(setSelectedPath)
  setSelectedPathRef.current = setSelectedPath
  const operationOwnerRef = useRef(operationOwner)
  operationOwnerRef.current = operationOwner

  const importPaths = useCallback(
    async ({
      paths,
      destinationDir,
      worktreeId,
      worktreeRootPath,
      operationGuard,
      showSuccess
    }: {
      paths: string[]
      destinationDir: string
      worktreeId: string
      worktreeRootPath: string
      operationGuard: ReturnType<typeof captureFileExplorerOperationGuard>
      showSuccess?: boolean
    }): Promise<void> => {
      operationGuard.assertCurrent()
      const { results } = await importExternalPathsToRuntime(
        {
          settings: operationGuard.route.settings,
          worktreeId,
          worktreePath: worktreeRootPath,
          connectionId: operationGuard.route.connectionId,
          expectedExecutionHostId: operationGuard.route.expectedExecutionHostId,
          expectedSshTargetId: operationGuard.route.expectedSshTargetId,
          expectedSshConnectionGeneration: operationGuard.route.expectedSshConnectionGeneration
        },
        paths,
        destinationDir,
        { assertCurrent: operationGuard.assertCurrent }
      )

      const isImportOwnerCurrent = (): boolean => {
        // Why: the transfer may finish after the user changed workspaces. Keep
        // the completed upload, but never refresh/select inside the new owner UI.
        if (
          activeWorktreeIdRef.current !== worktreeId ||
          worktreePathRef.current !== worktreeRootPath
        ) {
          return false
        }
        try {
          operationGuard.assertCurrent()
          return true
        } catch {
          toast.error(
            translate(
              'auto.components.right.sidebar.useFileExplorerImport.connectionChanged',
              'The connection changed during the upload. Check the destination before trying again.'
            )
          )
          return false
        }
      }

      // The SSH importer reports generation failures per item instead of
      // rejecting the batch. Fence before refresh so a retired session cannot
      // silently refresh the replacement connection and hide the failure.
      if (!isImportOwnerCurrent()) {
        return
      }

      await refreshDirRef.current(destinationDir)

      // Why: refresh itself can wait on SSH. Re-check after it resolves so a
      // completed upload from server A cannot select a stale path in server B.
      if (!isImportOwnerCurrent()) {
        return
      }

      const imported = results.filter((result) => result.status === 'imported')
      const skipped = results.filter((result) => result.status === 'skipped')
      const failed = results.filter((result) => result.status === 'failed')

      if (imported.length > 0) {
        setSelectedPathRef.current(imported[0].destPath)
        if (showSuccess) {
          toast.success(
            translate(
              'auto.components.right.sidebar.useFileExplorerImport.uploadedItems',
              'Uploaded {{count}} item(s).',
              { count: imported.length }
            )
          )
        }
      }

      if (failed.length > 0) {
        toast.error(
          failed.length === 1
            ? translate(
                'auto.components.right.sidebar.useFileExplorerImport.uploadFailedOne',
                'Failed to upload 1 item.'
              )
            : translate(
                'auto.components.right.sidebar.useFileExplorerImport.uploadFailedMany',
                'Failed to upload {{count}} items.',
                { count: failed.length }
              )
        )
      }
      if (skipped.length > 0) {
        toast.error(
          skipped.length === 1
            ? translate(
                'auto.components.right.sidebar.useFileExplorerImport.uploadSkippedOne',
                'Skipped 1 item.'
              )
            : translate(
                'auto.components.right.sidebar.useFileExplorerImport.uploadSkippedMany',
                'Skipped {{count}} items.',
                { count: skipped.length }
              )
        )
      }
    },
    []
  )

  const pickAndUpload = useCallback(
    async (kind: Exclude<FileExplorerUploadAction, null>, destinationDir: string) => {
      if (uploadInProgressRef.current) {
        return
      }
      const worktreeId = activeWorktreeIdRef.current
      const worktreeRootPath = worktreePathRef.current
      if (!worktreeId || !worktreeRootPath) {
        return
      }

      // Why: capture ownership before opening the native picker. The user can
      // switch workspaces or reconnect SSH while the dialog is still open.
      uploadInProgressRef.current = true
      setUploadAction(kind)
      try {
        const operationGuard = captureFileExplorerOperationGuard(
          worktreeId,
          operationOwnerRef.current ?? getFileExplorerOperationOwner(worktreeId)
        )
        const paths =
          kind === 'files'
            ? await window.api.shell.pickFiles()
            : [await window.api.shell.pickDirectory({})].filter(
                (path): path is string => typeof path === 'string'
              )
        operationGuard.assertCurrent()
        if (
          activeWorktreeIdRef.current !== worktreeId ||
          worktreePathRef.current !== worktreeRootPath
        ) {
          throw new Error(
            translate(
              'auto.components.right.sidebar.useFileExplorerImport.workspaceChanged',
              'The active workspace changed while selecting files.'
            )
          )
        }
        if (paths.length === 0) {
          return
        }
        await importPaths({
          paths,
          destinationDir,
          worktreeId,
          worktreeRootPath,
          operationGuard,
          showSuccess: true
        })
      } catch (error) {
        toast.error(
          extractIpcErrorMessage(
            error,
            translate(
              'auto.components.right.sidebar.useFileExplorerImport.uploadFailed',
              'Failed to upload files.'
            )
          )
        )
      } finally {
        uploadInProgressRef.current = false
        setUploadAction(null)
      }
    },
    [importPaths]
  )

  const uploadFiles = useCallback(
    (destinationDir: string) => pickAndUpload('files', destinationDir),
    [pickAndUpload]
  )
  const uploadFolder = useCallback(
    (destinationDir: string) => pickAndUpload('folder', destinationDir),
    [pickAndUpload]
  )

  useEffect(() => {
    return window.api.ui.onFileDrop((data) => {
      if (data.target !== 'file-explorer') {
        return
      }

      const wtId = activeWorktreeIdRef.current
      const worktreeRootPath = worktreePathRef.current
      if (!wtId || !worktreeRootPath) {
        // Why: the preload stops propagation of the native drop event, so
        // React onDrop handlers never fire. We must clear the drag highlight
        // ourselves even when we bail out, otherwise the explorer stays stuck
        // in its drag-over visual state.
        clearNativeDragStateRef.current()
        return
      }
      if (uploadInProgressRef.current) {
        toast.error(
          translate(
            'auto.components.right.sidebar.useFileExplorerImport.uploadAlreadyInProgress',
            'An upload is already in progress. Try again when it finishes.'
          )
        )
        clearNativeDragStateRef.current()
        return
      }

      const { paths, destinationDir } = data
      uploadInProgressRef.current = true
      setUploadAction('files')

      void (async () => {
        try {
          if (data.workspaceId !== wtId || data.workspaceRootPath !== worktreePathRef.current) {
            throw new Error(
              translate(
                'auto.components.right.sidebar.useFileExplorerImport.workspaceChanged',
                'The active workspace changed while selecting files.'
              )
            )
          }
          const operationGuard = captureFileExplorerOperationGuard(
            wtId,
            operationOwnerRef.current ?? getFileExplorerOperationOwner(wtId)
          )
          if (operationGuard.ownerSnapshot !== data.ownerSnapshot) {
            throw new Error(
              translate(
                'auto.components.right.sidebar.useFileExplorerImport.workspaceChanged',
                'The active workspace changed while selecting files.'
              )
            )
          }
          await importPaths({
            paths,
            destinationDir,
            worktreeId: wtId,
            worktreeRootPath,
            operationGuard
          })
        } catch (err) {
          toast.error(
            extractIpcErrorMessage(
              err,
              translate(
                'auto.components.right.sidebar.useFileExplorerImport.importFailed',
                'Failed to import files.'
              )
            )
          )
        } finally {
          uploadInProgressRef.current = false
          setUploadAction(null)
          clearNativeDragStateRef.current()
        }
      })()
    })
  }, [importPaths])

  return { uploadAction, uploadFiles, uploadFolder }
}
