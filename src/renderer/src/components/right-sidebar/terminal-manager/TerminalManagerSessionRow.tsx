import { useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import { stripLeadingAgentTitleDecoration } from '../../../../../shared/agent-title-decoration'
import { resolveTerminalTabTitle } from '../../../../../shared/tab-title-resolution'
import { translate } from '@/i18n/i18n'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { useTabAgent } from '@/lib/use-tab-agent'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { Input } from '@/components/ui/input'
import {
  isTerminalTabActivityLive,
  resolveTerminalTabActivityStatus,
  terminalTabHasUnreadActivity
} from '../../tab-bar/terminal-tab-activity-status'
import { closeTerminalTab } from '../../terminal/terminal-tab-actions'
import { activateWorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-activation'
import type { WorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-order'
import {
  terminalManagerSessionDragId,
  terminalManagerSessionDropId,
  type TerminalManagerDragData,
  type TerminalManagerDropData
} from './terminal-manager-dnd'
import type { TerminalManagerGroup } from './terminal-manager-layout'
import type { TerminalManagerSelectionGesture } from './terminal-manager-selection'
import { TerminalManagerSessionCloseButton } from './TerminalManagerSessionCloseButton'
import { TerminalManagerSessionButton } from './TerminalManagerSessionButton'
import { TerminalManagerSessionContextMenu } from './TerminalManagerSessionContextMenu'
import { useTerminalManagerInlineRenameFocus } from './use-terminal-manager-inline-rename-focus'
import type { TerminalManagerSessionLocation } from './terminal-manager-session-location'

type Props = {
  groupId: string | null
  groups: readonly TerminalManagerGroup[]
  isActive: boolean
  isSelected: boolean
  onMove: (sessionId: string, groupId: string | null, beforeSessionId?: string) => void
  onSelect: (sessionId: string, gesture: TerminalManagerSelectionGesture) => void
  session: WorktreeTerminalSession
  location: TerminalManagerSessionLocation
}

export function TerminalManagerSessionRow({
  groupId,
  groups,
  isActive,
  isSelected,
  onMove,
  onSelect,
  session,
  location
}: Props): React.JSX.Element {
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
  const dragData: TerminalManagerDragData = {
    kind: 'terminal-manager-session',
    sessionId: tab.id
  }
  const dropData: TerminalManagerDropData = {
    kind: 'terminal-manager-session-target',
    groupId,
    beforeSessionId: tab.id
  }
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef: setDragNodeRef
  } = useDraggable({ id: terminalManagerSessionDragId(tab.id), data: dragData })
  const { isOver, setNodeRef: setDropNodeRef } = useDroppable({
    id: terminalManagerSessionDropId(tab.id),
    data: dropData
  })

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
  const renameFocus = useTerminalManagerInlineRenameFocus({
    active: isRenaming,
    isResolved: () => renameResolvedRef.current,
    onCommit: commitRename
  })
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
      ref={(node) => {
        setDragNodeRef(node)
        setDropNodeRef(node)
      }}
      className={cn(
        'group/session flex min-h-10 min-w-0 items-center rounded-md border border-transparent text-foreground transition-colors',
        isActive ? 'bg-accent' : 'hover:bg-accent/60',
        isSelected && 'border-ring/30 bg-accent/55',
        isOver && 'border-ring/60 bg-accent/75',
        isDragging && 'opacity-60'
      )}
      data-terminal-manager-session-id={tab.id}
      data-terminal-manager-session-selected={isSelected ? 'true' : 'false'}
      data-current={isActive ? 'true' : undefined}
      data-agent-activity-status={activityStatus}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex w-5 shrink-0 self-stretch touch-none cursor-grab items-center justify-center text-muted-foreground/45 outline-none active:cursor-grabbing focus-visible:text-foreground"
        data-terminal-manager-session-drag-handle="true"
        aria-label={translate('terminalManager.dragSession', 'Drag session {{value0}}', {
          value0: displayTitle
        })}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </button>
      {isRenaming ? (
        <Input
          ref={renameFocus.inputRef}
          value={renameValue}
          data-tab-rename-input="true"
          aria-label={translate('terminalManager.renameSessionInput', 'Rename session {{value0}}', {
            value0: displayTitle
          })}
          className="mx-1 h-7 min-w-0 flex-1 px-2 py-0 text-xs"
          spellCheck={false}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={renameFocus.onBlur}
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
        <TerminalManagerSessionButton
          activityStatus={activityStatus}
          displayTitle={displayTitle}
          isActive={isActive}
          isPinned={isPinned}
          isSelected={isSelected}
          showUnreadActivity={showUnreadActivity}
          tab={tab}
          tabAgent={tabAgent}
          location={location}
          onClick={(event) => {
            const additive = event.ctrlKey || event.metaKey
            const range = event.shiftKey
            onSelect(tab.id, { additive, range })
            if (!additive && !range) {
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
        />
      )}
      {!isRenaming && !isPinned ? (
        <TerminalManagerSessionCloseButton displayTitle={displayTitle} onClose={closeSession} />
      ) : null}
    </div>
  )

  return (
    <TerminalManagerSessionContextMenu
      groupId={groupId}
      groups={groups}
      isPinned={isPinned}
      pinDisabled={!unifiedTab}
      onRename={beginRename}
      onMove={(targetGroupId) => onMove(tab.id, targetGroupId)}
      onTogglePin={togglePin}
      onClose={closeSession}
    >
      {row}
    </TerminalManagerSessionContextMenu>
  )
}
