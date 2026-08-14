import { useRef, useState } from 'react'
import { Pencil, Pin, PinOff, X } from 'lucide-react'
import { stripLeadingAgentTitleDecoration } from '../../../../shared/agent-title-decoration'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import { translate } from '@/i18n/i18n'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { useTabAgent } from '@/lib/use-tab-agent'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { TerminalTabLeadingIcon } from '../tab-bar/TerminalTabLeadingIcon'
import {
  isTerminalTabActivityLive,
  resolveTerminalTabActivityStatus,
  terminalTabHasUnreadActivity
} from '../tab-bar/terminal-tab-activity-status'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { activateWorktreeTerminalSession } from './worktree-terminal-session-activation'
import type { WorktreeTerminalSession } from './worktree-terminal-session-order'

export function WorktreeTerminalSessionRow({
  session,
  isActive
}: {
  session: WorktreeTerminalSession
  isActive: boolean
}): React.JSX.Element {
  const { tab, unifiedTab } = session
  const generatedTitlesEnabled = useAppStore(
    (state) => state.settings?.tabAutoGenerateTitle === true
  )
  const hasUnreadActivity = useAppStore((state) =>
    terminalTabHasUnreadActivity({
      terminalTabId: tab.id,
      unreadTerminalTabs: state.unreadTerminalTabs,
      unreadAgentCompletionPanes: state.unreadAgentCompletionPanes
    })
  )
  const activityStatus = useAppStore((state) =>
    resolveTerminalTabActivityStatus({
      tab,
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      agentStatusEpoch: state.agentStatusEpoch,
      runtimePaneTitlesByTabId: state.runtimePaneTitlesByTabId,
      ptyIdsByTabId: state.ptyIdsByTabId,
      terminalLayout: state.terminalLayoutsByTabId[tab.id]
    })
  )
  const tabAgent = useTabAgent(tab)
  const resolvedTitle = resolveTerminalTabTitle(
    tab,
    generatedTitlesEnabled,
    tab.defaultTitle ?? 'Terminal'
  )
  const displayTitle =
    tab.customTitle ?? (tabAgent ? stripLeadingAgentTitleDecoration(resolvedTitle) : resolvedTitle)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(displayTitle)
  const renameResolvedRef = useRef(false)
  const isPinned = Boolean(tab.isPinned || unifiedTab?.isPinned)
  const showUnreadActivity =
    hasUnreadActivity && !isRenaming && !isTerminalTabActivityLive(activityStatus)

  const beginRename = (): void => {
    renameResolvedRef.current = false
    setRenameValue(tab.customTitle ?? resolvedTitle)
    setIsRenaming(true)
  }
  const commitRename = (): void => {
    if (renameResolvedRef.current) {
      return
    }
    renameResolvedRef.current = true
    const title = renameValue.trim()
    useAppStore.getState().setTabCustomTitle(tab.id, title.length > 0 ? title : null)
    setIsRenaming(false)
  }
  const cancelRename = (): void => {
    renameResolvedRef.current = true
    setIsRenaming(false)
  }
  const togglePin = (): void => {
    if (!unifiedTab) {
      return
    }
    const state = useAppStore.getState()
    if (isPinned) {
      state.unpinTab(unifiedTab.id)
    } else {
      state.pinTab(unifiedTab.id)
    }
  }
  const closeSession = (): void => {
    if (!isPinned) {
      closeTerminalTab(tab.id)
    }
  }

  const row = (
    <div
      className={cn(
        'group/session flex min-w-0 items-center rounded-md text-sidebar-foreground transition-colors',
        isActive ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'
      )}
      data-terminal-session-id={tab.id}
      data-current={isActive ? 'true' : undefined}
      data-agent-activity-status={activityStatus}
    >
      {isRenaming ? (
        <Input
          autoFocus
          value={renameValue}
          aria-label={translate(
            'sidebarTerminalSessions.renameInput',
            'Rename terminal session {{value0}}',
            { value0: displayTitle }
          )}
          className="ml-1 h-7 min-w-0 flex-1 px-2 py-0 text-xs"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (isImeCompositionKeyDown(event)) {
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              commitRename()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelRename()
            }
          }}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 flex-1 justify-start gap-0 rounded-md px-2 text-xs font-normal hover:bg-transparent"
          aria-current={isActive ? 'page' : undefined}
          onClick={() => activateWorktreeTerminalSession(tab.worktreeId, tab.id)}
          onDoubleClick={(event) => {
            event.preventDefault()
            beginRename()
          }}
          onAuxClick={(event) => {
            if (event.button !== 1 || isPinned) {
              return
            }
            event.preventDefault()
            closeSession()
          }}
        >
          <TerminalTabLeadingIcon
            agent={tabAgent}
            activityStatus={activityStatus}
            shell={tab.shellOverride}
            showUnreadActivity={showUnreadActivity}
            isActive={isActive}
          />
          {isPinned ? <Pin className="mr-1 size-3 shrink-0 text-muted-foreground" /> : null}
          <span className="min-w-0 flex-1 truncate text-left">{displayTitle}</span>
          {tab.color ? (
            <span
              className="ml-1 size-2 shrink-0 rounded-full"
              style={{ backgroundColor: tab.color }}
              aria-hidden
            />
          ) : null}
        </Button>
      )}
      {!isRenaming && !isPinned ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="mr-0.5 size-6 shrink-0 opacity-0 hover:bg-sidebar-accent group-hover/session:opacity-100 focus-visible:opacity-100"
          aria-label={translate('sidebarTerminalSessions.close', 'Close {{value0}}', {
            value0: displayTitle
          })}
          onClick={closeSession}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={beginRename}>
          <Pencil />
          {translate('sidebarTerminalSessions.rename', 'Rename')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={togglePin} disabled={!unifiedTab}>
          {isPinned ? <PinOff /> : <Pin />}
          {isPinned
            ? translate('sidebarTerminalSessions.unpin', 'Unpin session')
            : translate('sidebarTerminalSessions.pin', 'Pin session')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={closeSession} disabled={isPinned}>
          <X />
          {translate('sidebarTerminalSessions.closeAction', 'Close session')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
