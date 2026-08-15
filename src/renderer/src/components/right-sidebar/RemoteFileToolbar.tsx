import React from 'react'
import {
  ArrowUp,
  CornerDownLeft,
  Download,
  FileUp,
  FolderOpen,
  FolderUp,
  Home,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

export type RemoteFileToolbarBusyAction =
  | 'navigate'
  | 'refresh'
  | 'upload-files'
  | 'upload-folder'
  | 'download'
  | null

export type RemoteFileToolbarProps = {
  pathValue: string
  onPathValueChange: (value: string) => void
  onNavigatePath: (path: string) => void
  onNavigateUp: () => void
  onNavigateHome: () => void
  onRefresh: () => void
  onUploadFiles: () => void
  onUploadFolder: () => void
  onDownloadSelected: () => void
  canNavigatePath?: boolean
  canNavigateUp?: boolean
  canNavigateHome?: boolean
  canRefresh?: boolean
  canUploadFiles?: boolean
  canUploadFolder?: boolean
  canDownloadSelected?: boolean
  busyAction?: RemoteFileToolbarBusyAction
  className?: string
}

type ToolbarActionProps = {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}

function ToolbarAction({
  label,
  disabled,
  onClick,
  children
}: ToolbarActionProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            'text-muted-foreground hover:text-foreground',
            disabled && 'cursor-not-allowed opacity-50'
          )}
          aria-label={label}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) {
              event.preventDefault()
              return
            }
            onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function ToolbarSeparator(): React.JSX.Element {
  return <span role="separator" aria-orientation="vertical" className="mx-0.5 h-4 w-px bg-border" />
}

export function RemoteFileToolbar({
  pathValue,
  onPathValueChange,
  onNavigatePath,
  onNavigateUp,
  onNavigateHome,
  onRefresh,
  onUploadFiles,
  onUploadFolder,
  onDownloadSelected,
  canNavigatePath = true,
  canNavigateUp = true,
  canNavigateHome = true,
  canRefresh = true,
  canUploadFiles = true,
  canUploadFolder = true,
  canDownloadSelected = false,
  busyAction = null,
  className
}: RemoteFileToolbarProps): React.JSX.Element {
  const isBusy = busyAction !== null
  const pathDisabled = !canNavigatePath || isBusy
  const submitPath = (): void => {
    const path = pathValue.trim()
    if (!pathDisabled && path) {
      onNavigatePath(path)
    }
  }

  return (
    <nav
      data-ignore-file-explorer-keys="true"
      aria-label={translate(
        'auto.components.right.sidebar.RemoteFileToolbar.remoteFileControls',
        'Remote file controls'
      )}
      aria-busy={busyAction !== null}
      className={cn('border-b border-border bg-background', className)}
    >
      <div
        role="group"
        aria-label={translate(
          'auto.components.right.sidebar.RemoteFileToolbar.remoteFileActions',
          'Remote file actions'
        )}
        className="flex h-8 items-center gap-0.5 px-1.5"
      >
        <ToolbarAction
          label={translate(
            'auto.components.right.sidebar.RemoteFileToolbar.parentFolder',
            'Parent folder'
          )}
          disabled={!canNavigateUp || isBusy}
          onClick={onNavigateUp}
        >
          <ArrowUp />
        </ToolbarAction>
        <ToolbarAction
          label={translate(
            'auto.components.right.sidebar.RemoteFileToolbar.homeFolder',
            'Home folder'
          )}
          disabled={!canNavigateHome || isBusy}
          onClick={onNavigateHome}
        >
          <Home />
        </ToolbarAction>
        <ToolbarSeparator />
        <ToolbarAction
          label={translate('auto.components.right.sidebar.RemoteFileToolbar.refresh', 'Refresh')}
          disabled={!canRefresh || isBusy}
          onClick={onRefresh}
        >
          {busyAction === 'refresh' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </ToolbarAction>
        <ToolbarSeparator />
        <ToolbarAction
          label={translate(
            'auto.components.right.sidebar.RemoteFileToolbar.uploadFiles',
            'Upload files'
          )}
          disabled={!canUploadFiles || isBusy}
          onClick={onUploadFiles}
        >
          {busyAction === 'upload-files' ? <Loader2 className="animate-spin" /> : <FileUp />}
        </ToolbarAction>
        <ToolbarAction
          label={translate(
            'auto.components.right.sidebar.RemoteFileToolbar.uploadFolder',
            'Upload folder'
          )}
          disabled={!canUploadFolder || isBusy}
          onClick={onUploadFolder}
        >
          {busyAction === 'upload-folder' ? <Loader2 className="animate-spin" /> : <FolderUp />}
        </ToolbarAction>
        <ToolbarAction
          label={translate(
            'auto.components.right.sidebar.RemoteFileToolbar.downloadSelected',
            'Download selected'
          )}
          disabled={!canDownloadSelected || isBusy}
          onClick={onDownloadSelected}
        >
          {busyAction === 'download' ? <Loader2 className="animate-spin" /> : <Download />}
        </ToolbarAction>
      </div>

      {busyAction ? (
        <span role="status" aria-live="polite" className="sr-only">
          {translate(
            'auto.components.right.sidebar.RemoteFileToolbar.operationInProgress',
            'Remote file operation in progress'
          )}
        </span>
      ) : null}

      <form
        aria-label={translate(
          'auto.components.right.sidebar.RemoteFileToolbar.remoteLocation',
          'Remote location'
        )}
        className="flex h-8 items-center gap-1 border-t border-border px-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          submitPath()
        }}
      >
        <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          aria-label={translate(
            'auto.components.right.sidebar.RemoteFileToolbar.remotePath',
            'Remote path'
          )}
          value={pathValue}
          disabled={pathDisabled}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-6 rounded-md px-2 py-0 font-mono text-xs shadow-none"
          onChange={(event) => onPathValueChange(event.currentTarget.value)}
        />
        <ToolbarAction
          label={translate(
            'auto.components.right.sidebar.RemoteFileToolbar.goToPath',
            'Go to path'
          )}
          disabled={pathDisabled || pathValue.trim().length === 0}
          onClick={submitPath}
        >
          {busyAction === 'navigate' ? <Loader2 className="animate-spin" /> : <CornerDownLeft />}
        </ToolbarAction>
      </form>
    </nav>
  )
}
