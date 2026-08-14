import { useRef, useState } from 'react'
import { Check, FolderInput, GripVertical, Pencil, Pin, PinOff, X } from 'lucide-react'
import { stripLeadingAgentTitleDecoration } from '../../../../../shared/agent-title-decoration'
import { resolveTerminalTabTitle } from '../../../../../shared/tab-title-resolution'
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
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { TerminalTabLeadingIcon } from '../../tab-bar/TerminalTabLeadingIcon'
import {
  isTerminalTabActivityLive,
  resolveTerminalTabActivityStatus,
  terminalTabHasUnreadActivity
} from '../../tab-bar/terminal-tab-activity-status'
import { closeTerminalTab } from '../../terminal/terminal-tab-actions'
import { activateWorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-activation'
import type { WorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-order'
import type { TerminalManagerGroup } from './terminal-manager-layout'
import {
  hasTerminalManagerSessionDrag,
  readTerminalManagerSessionDrag,
  writeTerminalManagerSessionDrag
} from './terminal-manager-drag-data'

type Props = {
  session: WorktreeTerminalSession
  isActive: boolean
  groupId: string | null
  groups: readonly TerminalManagerGroup[]
  onMove: (sessionId: string, groupId: string | null, beforeSessionId?: string) => void
}

export function TerminalManagerSessionRow(props: Props): React.JSX.Element {
  const { session, isActive, groupId, groups, onMove } = props
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
  const [isDropTarget, setIsDropTarget] = useState(false)
  const renameResolvedRef = useRef(false)
  const wasDraggedRef = useRef(false)
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
        'group/session flex min-w-0 items-center rounded-md border border-transparent text-foreground transition-colors',
        isActive ? 'bg-accent' : 'hover:bg-accent/60',
        isDropTarget && 'border-ring/50 bg-accent/70'
      )}
      data-terminal-manager-session-id={tab.id}
      data-current={isActive ? 'true' : undefined}
      data-agent-activity-status={activityStatus}
      onDragEnd={() => {
        setIsDropTarget(false)
        window.setTimeout(() => {
          wasDraggedRef.current = false
        }, 0)
      }}
      onDragOver={(event) => {
        if (!hasTerminalManagerSessionDrag(event.dataTransfer)) {
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setIsDropTarget(true)
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(event) => {
        const sessionId = readTerminalManagerSessionDrag(event.dataTransfer)
        if (!sessionId) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        setIsDropTarget(false)
        if (sessionId !== tab.id) {
          onMove(sessionId, groupId, tab.id)
        }
      }}
    >
      <span
        className="ml-0.5 flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/45 active:cursor-grabbing"
        data-terminal-manager-session-drag-handle="true"
        draggable={!isRenaming}
        aria-label={translate('terminalManager.dragSession', 'Drag session {{value0}}', {
          value0: displayTitle
        })}
        onDragStart={(event) => {
          wasDraggedRef.current = true
          writeTerminalManagerSessionDrag(event.dataTransfer, tab.id)
        }}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </span>
      {isRenaming ? (
        <Input
          autoFocus
          value={renameValue}
          aria-label={translate('terminalManager.renameSessionInput', 'Rename session {{value0}}', {
            value0: displayTitle
          })}
          className="mx-1 h-7 min-w-0 flex-1 px-2 py-0 text-xs"
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
          className="h-8 min-w-0 flex-1 justify-start gap-0 rounded-md px-1.5 text-xs font-normal hover:bg-transparent"
          aria-current={isActive ? 'page' : undefined}
          aria-label={displayTitle}
          onClick={() => {
            if (!wasDraggedRef.current) {
              activateWorktreeTerminalSession(tab.worktreeId, tab.id)
            }
          }}
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
              aria-hidden="true"
            />
          ) : null}
        </Button>
      )}
      {!isRenaming && !isPinned ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="mr-0.5 size-6 shrink-0 opacity-0 hover:bg-accent group-hover/session:opacity-100 focus-visible:opacity-100"
          aria-label={translate('terminalManager.close', 'Close {{value0}}', {
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
          {translate('terminalManager.renameSession', 'Rename session')}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput />
            {translate('terminalManager.moveToGroup', 'Move to group')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => onMove(tab.id, null)}>
              {groupId === null ? <Check /> : <span className="size-3.5" />}
              {translate('terminalManager.ungrouped', 'Ungrouped')}
            </ContextMenuItem>
            {groups.map((group) => (
              <ContextMenuItem key={group.id} onSelect={() => onMove(tab.id, group.id)}>
                {groupId === group.id ? <Check /> : <span className="size-3.5" />}
                {group.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={togglePin} disabled={!unifiedTab}>
          {isPinned ? <PinOff /> : <Pin />}
          {isPinned
            ? translate('terminalManager.unpin', 'Unpin session')
            : translate('terminalManager.pin', 'Pin session')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={closeSession} disabled={isPinned} variant="destructive">
          <X />
          {translate('terminalManager.closeSession', 'Close session')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
