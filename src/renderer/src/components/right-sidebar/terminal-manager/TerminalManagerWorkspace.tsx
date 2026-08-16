import { useMemo } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { useShallow } from 'zustand/react/shallow'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import { useAppStore } from '@/store'
import { createWorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-activation'
import {
  orderWorktreeTerminalSessions,
  type WorktreeTerminalSession
} from '../../sidebar/worktree-terminal-session-order'
import {
  addTerminalManagerGroup,
  deleteTerminalManagerGroup,
  moveTerminalManagerGroup,
  moveTerminalManagerSessions,
  renameTerminalManagerGroup,
  sessionsForTerminalManagerGroup,
  toggleTerminalManagerGroup
} from './terminal-manager-layout'
import { TerminalManagerGroupEndDropTarget } from './TerminalManagerGroupEndDropTarget'
import { TerminalManagerGroupSection } from './TerminalManagerGroupSection'
import { TerminalManagerSelectionBar } from './TerminalManagerSelectionBar'
import { TerminalManagerWorkspaceHeader } from './TerminalManagerWorkspaceHeader'
import { useTerminalManagerDnd } from './use-terminal-manager-dnd'
import { useTerminalManagerLayout } from './use-terminal-manager-layout'
import { useTerminalManagerSelection } from './use-terminal-manager-selection'
import { useTerminalManagerWorkingDirectories } from './use-terminal-manager-working-directories'
import { resolveChecksPanelTerminalPtyId } from '../checks-panel-terminal-worktree'
import {
  resolveTerminalManagerSessionHost,
  type TerminalManagerSessionLocation
} from './terminal-manager-session-location'

const EMPTY_TERMINAL_TABS: readonly TerminalTab[] = []
const EMPTY_UNIFIED_TABS = [] as const
const EMPTY_TAB_GROUPS = [] as const

export function TerminalManagerWorkspace({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element {
  const terminalTabs = useAppStore(
    (state) => state.tabsByWorktree[worktreeId] ?? EMPTY_TERMINAL_TABS
  )
  const unifiedTabs = useAppStore(
    (state) => state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS
  )
  const tabGroups = useAppStore((state) => state.groupsByWorktree[worktreeId] ?? EMPTY_TAB_GROUPS)
  const activeTerminalTabId = useAppStore((state) =>
    state.activeWorktreeId === worktreeId && state.activeTabType === 'terminal'
      ? state.activeTabId
      : null
  )
  const executionHostId = useAppStore((state) =>
    getResolvedExecutionHostIdForWorktree(state, worktreeId)
  )
  const worktree = useAppStore(
    (state) => state.getKnownWorktreeById(worktreeId, executionHostId ?? undefined) ?? null
  )
  const sshTargetHosts = useAppStore((state) => state.sshTargetHosts)
  const sshTargetLabels = useAppStore((state) => state.sshTargetLabels)
  const runtimeSshTargets = useAppStore((state) => state.sshStateByEnvironment)
  const runtimeEnvironments = useAppStore((state) => state.runtimeEnvironments)
  const completionNotificationsEnabled = useAppStore(
    (state) =>
      state.settings?.notifications.enabled === true &&
      state.settings.notifications.agentTaskComplete === true
  )
  const sessions = useMemo(
    () => orderWorktreeTerminalSessions(terminalTabs, unifiedTabs, tabGroups),
    [tabGroups, terminalTabs, unifiedTabs]
  )
  const sessionPtyIds = useAppStore(
    useShallow((state) =>
      sessions.map(
        (session) =>
          resolveChecksPanelTerminalPtyId({
            activeTabId: session.tab.id,
            ptyIdsByTabId: state.ptyIdsByTabId,
            terminalLayoutsByTabId: state.terminalLayoutsByTabId
          }) ??
          session.tab.ptyId ??
          state.lastKnownRelayPtyIdByTabId[session.tab.id] ??
          null
      )
    )
  )
  const sessionIds = useMemo(() => sessions.map((session) => session.tab.id), [sessions])
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.tab.id, session])),
    [sessions]
  )
  const [layout, setLayout] = useTerminalManagerLayout(worktreeId, sessionIds)
  const workingDirectoryBySessionId = useTerminalManagerWorkingDirectories({
    activeTerminalTabId,
    layout,
    sessions,
    worktreePath: worktree?.path ?? null
  })
  const locationBySessionId = useMemo<ReadonlyMap<string, TerminalManagerSessionLocation>>(
    () =>
      new Map(
        sessions.map((session, index) => [
          session.tab.id,
          {
            cwd: workingDirectoryBySessionId.get(session.tab.id) ?? null,
            host: resolveTerminalManagerSessionHost({
              executionHostId,
              ptyId: sessionPtyIds[index] ?? null,
              runtimeEnvironments,
              runtimeSshTargets,
              sshTargetHosts,
              sshTargetLabels
            })
          }
        ])
      ),
    [
      executionHostId,
      runtimeEnvironments,
      runtimeSshTargets,
      sessionPtyIds,
      sessions,
      sshTargetHosts,
      sshTargetLabels,
      workingDirectoryBySessionId
    ]
  )
  const visualSessionIds = useMemo(
    () => [
      ...layout.groups.flatMap((group) => sessionsForTerminalManagerGroup(layout, group.id)),
      ...sessionsForTerminalManagerGroup(layout, null)
    ],
    [layout]
  )
  const selection = useTerminalManagerSelection(visualSessionIds)
  const projectName = worktree?.displayName || worktree?.branch || worktreeId

  const resolveSessions = (ids: readonly string[]): WorktreeTerminalSession[] =>
    ids.flatMap((id) => {
      const session = sessionById.get(id)
      return session ? [session] : []
    })
  const moveSessions = (
    ids: readonly string[],
    groupId: string | null,
    beforeSessionId?: string
  ): void => {
    setLayout((current) => moveTerminalManagerSessions(current, ids, groupId, beforeSessionId))
  }
  const moveSession = (
    sessionId: string,
    groupId: string | null,
    beforeSessionId?: string
  ): void => {
    moveSessions(selection.prepareBatchAction(sessionId), groupId, beforeSessionId)
  }
  const moveGroup = (groupId: string, beforeGroupId?: string | null): void => {
    setLayout((current) => moveTerminalManagerGroup(current, groupId, beforeGroupId))
  }
  const dnd = useTerminalManagerDnd({
    moveGroup,
    moveSessions,
    prepareSessionDrag: selection.prepareBatchAction
  })
  const toggleCompletionNotifications = (): void => {
    const state = useAppStore.getState()
    const notifications = state.settings?.notifications
    if (!notifications) {
      return
    }
    void state.updateSettings({
      notifications: {
        ...notifications,
        enabled: completionNotificationsEnabled ? notifications.enabled : true,
        agentTaskComplete: !completionNotificationsEnabled
      }
    })
  }
  const overlayLabel = (() => {
    const activeDrag = dnd.activeDrag
    if (!activeDrag) {
      return ''
    }
    if (activeDrag.kind === 'group') {
      return layout.groups.find((group) => group.id === activeDrag.groupId)?.name ?? ''
    }
    if (activeDrag.sessionIds.length > 1) {
      return translate('terminalManager.selectedCount', '{{value0}} sessions selected', {
        value0: activeDrag.sessionIds.length
      })
    }
    const draggedSession = sessionById.get(activeDrag.sessionIds[0] ?? '')
    return draggedSession?.tab.customTitle ?? draggedSession?.tab.title ?? 'Terminal'
  })()

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-terminal-manager-workspace={worktreeId}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !dnd.activeDrag) {
            selection.clear()
          }
        }}
      >
        <TerminalManagerWorkspaceHeader
          projectName={projectName}
          completionNotificationsEnabled={completionNotificationsEnabled}
          onAddGroup={(name) =>
            setLayout((current) =>
              addTerminalManagerGroup(current, {
                id: `group-${createBrowserUuid()}`,
                name
              })
            )
          }
          onCreateSession={() => createWorktreeTerminalSession(worktreeId)}
          onToggleCompletionNotifications={toggleCompletionNotifications}
        />
        <TerminalManagerSelectionBar
          count={selection.selectedIds.length}
          onClear={selection.clear}
        />
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2 scrollbar-sleek">
          {layout.groups.map((group, index) => (
            <TerminalManagerGroupSection
              key={group.id}
              group={group}
              collapsed={group.collapsed}
              sessions={resolveSessions(sessionsForTerminalManagerGroup(layout, group.id))}
              groups={layout.groups}
              locationBySessionId={locationBySessionId}
              activeTerminalTabId={activeTerminalTabId}
              groupIndex={index}
              isSessionSelected={selection.isSelected}
              onSelectSession={selection.select}
              onToggle={(groupId) =>
                setLayout((current) => toggleTerminalManagerGroup(current, groupId))
              }
              onRename={(groupId, name) =>
                setLayout((current) => renameTerminalManagerGroup(current, groupId, name))
              }
              onDelete={(groupId) =>
                setLayout((current) => deleteTerminalManagerGroup(current, groupId))
              }
              onMoveGroup={moveGroup}
              onMoveSession={moveSession}
            />
          ))}
          <TerminalManagerGroupEndDropTarget />
          <TerminalManagerGroupSection
            group={null}
            collapsed={layout.ungroupedCollapsed}
            sessions={resolveSessions(sessionsForTerminalManagerGroup(layout, null))}
            groups={layout.groups}
            locationBySessionId={locationBySessionId}
            activeTerminalTabId={activeTerminalTabId}
            groupIndex={layout.groups.length}
            isSessionSelected={selection.isSelected}
            onSelectSession={selection.select}
            onToggle={() => setLayout((current) => toggleTerminalManagerGroup(current, null))}
            onRename={() => undefined}
            onDelete={() => undefined}
            onMoveGroup={() => undefined}
            onMoveSession={moveSession}
          />
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {overlayLabel ? (
          <div
            className="max-w-52 truncate rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            data-terminal-manager-drag-overlay="true"
          >
            {overlayLabel}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
