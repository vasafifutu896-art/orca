import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, Server, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import type { SshConnectionStatus } from '../../../../shared/ssh-types'
import { isRuntimeOwnedSshTargetId } from '../../../../shared/execution-host'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { activateAndRevealFolderWorkspace } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { statusColor } from '@/components/settings/SshTargetCard'
import { AddRemoteHostDialog, type AddRemoteHostMode } from './AddRemoteHostDialog'
import { openSshServerSession } from './ssh-server-session'

function translatedStatus(status: SshConnectionStatus): string {
  switch (status) {
    case 'connected':
      return translate('auto.components.sidebar.SshServersPanel.connected', 'Connected')
    case 'connecting':
      return translate('auto.components.sidebar.SshServersPanel.connecting', 'Connecting…')
    case 'deploying-relay':
      return translate('auto.components.sidebar.SshServersPanel.deployingRelay', 'Starting relay…')
    case 'reconnecting':
      return translate('auto.components.sidebar.SshServersPanel.reconnecting', 'Reconnecting…')
    case 'auth-failed':
      return translate(
        'auto.components.sidebar.SshServersPanel.authFailed',
        'Authentication failed'
      )
    case 'reconnection-failed':
      return translate(
        'auto.components.sidebar.SshServersPanel.reconnectFailed',
        'Reconnect failed'
      )
    case 'error':
      return translate('auto.components.sidebar.SshServersPanel.error', 'Connection error')
    case 'disconnected':
      return translate('auto.components.sidebar.SshServersPanel.disconnected', 'Disconnected')
  }
}

export function SshServersPanel(): React.JSX.Element {
  const targetLabels = useAppStore((state) => state.sshTargetLabels)
  const connectionStates = useAppStore((state) => state.sshConnectionStates)
  const targetsHydrated = useAppStore((state) => state.sshTargetsHydrated)
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [openingTargetIds, setOpeningTargetIds] = useState<Set<string>>(() => new Set())
  const [addRemoteHostMode, setAddRemoteHostMode] = useState<AddRemoteHostMode | null>(null)
  const openingTargetIdsRef = useRef(new Set<string>())
  const mountedRef = useRef(true)
  const targets = useMemo(
    () =>
      [...targetLabels]
        .filter(([targetId]) => !isRuntimeOwnedSshTargetId(targetId))
        .map(([id, label]) => ({ id, label }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [targetLabels]
  )

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    []
  )

  const openSettings = useCallback(() => {
    const state = useAppStore.getState()
    state.recordFeatureInteraction('ssh')
    state.openSettingsTarget({ pane: 'ssh', repoId: null, sectionId: 'ssh' })
    state.openSettingsPage()
  }, [])

  const openTarget = useCallback(async (targetId: string, label: string) => {
    if (openingTargetIdsRef.current.has(targetId)) {
      return
    }
    openingTargetIdsRef.current.add(targetId)
    setOpeningTargetIds(new Set(openingTargetIdsRef.current))
    try {
      const result = await openSshServerSession(
        {
          targetId,
          label,
          homeWorkspaceName: translate('auto.components.sidebar.SshServersPanel.home', 'Home')
        },
        {
          getState: useAppStore.getState,
          connect: (id) => window.api.ssh.connect({ targetId: id }),
          browseHome: (id) => window.api.ssh.browseDir({ targetId: id, dirPath: '~' }),
          activateFolderWorkspace: activateAndRevealFolderWorkspace
        }
      )
      useAppStore.getState().recordFeatureInteraction('ssh')
      focusTerminalTabSurface(result.tabId)
    } catch (error) {
      toast.error(
        translate(
          'auto.components.sidebar.SshServersPanel.openFailed',
          'Could not open {{value0}}',
          { value0: label }
        ),
        { description: error instanceof Error ? error.message : String(error) }
      )
    } finally {
      openingTargetIdsRef.current.delete(targetId)
      if (mountedRef.current) {
        setOpeningTargetIds(new Set(openingTargetIdsRef.current))
      }
    }
  }, [])

  return (
    <section
      className="mt-2 shrink-0 border-b border-worktree-sidebar-border px-2 pb-2"
      aria-label={translate('auto.components.sidebar.SshServersPanel.title', 'Servers')}
    >
      <div className="flex h-8 items-center justify-between gap-2 px-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-muted-foreground/80 select-none">
            {translate('auto.components.sidebar.SshServersPanel.title', 'Servers')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label={translate(
                  'auto.components.sidebar.SshServersPanel.manage',
                  'Manage SSH servers'
                )}
                onClick={openSettings}
              >
                <Settings2 className="size-3.5" strokeWidth={2.25} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.sidebar.SshServersPanel.manage', 'Manage SSH servers')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate(
                  'auto.components.sidebar.SshServersPanel.add',
                  'Add SSH server'
                )}
                onClick={() => setAddRemoteHostMode('ssh')}
              >
                <Plus className="size-3.5" strokeWidth={2.25} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              {translate('auto.components.sidebar.SshServersPanel.add', 'Add SSH server')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="worktree-sidebar-scrollbar max-h-36 overflow-y-auto">
        {!targetsHydrated ? (
          <div className="flex h-9 items-center gap-2 px-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {translate('auto.components.sidebar.SshServersPanel.loading', 'Loading servers…')}
          </div>
        ) : targets.length === 0 ? (
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring"
            onClick={() => setAddRemoteHostMode('ssh')}
          >
            <Plus className="size-3.5" />
            {translate(
              'auto.components.sidebar.SshServersPanel.addFirst',
              'Add your first SSH server'
            )}
          </button>
        ) : (
          <div className="space-y-0.5">
            {targets.map((target) => {
              const status = connectionStates.get(target.id)?.status ?? 'disconnected'
              const opening = openingTargetIds.has(target.id)
              const selected = selectedTargetId === target.id
              return (
                <button
                  key={target.id}
                  type="button"
                  data-current={selected ? 'true' : undefined}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring',
                    selected && 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
                  )}
                  aria-label={translate(
                    'auto.components.sidebar.SshServersPanel.openLabel',
                    '{{value0}}, {{value1}}. Double-click to open a new terminal.',
                    { value0: target.label, value1: translatedStatus(status) }
                  )}
                  onClick={() => setSelectedTargetId(target.id)}
                  onDoubleClick={() => void openTarget(target.id, target.label)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void openTarget(target.id, target.label)
                    }
                  }}
                >
                  <span className="relative flex size-6 shrink-0 items-center justify-center">
                    <Server className="size-4 text-muted-foreground" />
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 size-2 rounded-full ring-2 ring-worktree-sidebar',
                        statusColor(status)
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{target.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {translatedStatus(status)}
                    </span>
                  </span>
                  {opening ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="px-2 pt-1 text-[11px] text-muted-foreground">
        {translate(
          'auto.components.sidebar.SshServersPanel.hint',
          'Double-click a server to open a terminal'
        )}
      </div>
      <AddRemoteHostDialog mode={addRemoteHostMode} onOpenChange={setAddRemoteHostMode} />
    </section>
  )
}
