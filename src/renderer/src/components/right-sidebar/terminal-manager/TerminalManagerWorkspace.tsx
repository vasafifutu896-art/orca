import { useMemo, useRef, useState } from 'react'
import { BellOff, BellRing, FolderPlus, Loader2, Plus } from 'lucide-react'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createWorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-activation'
import {
  orderWorktreeTerminalSessions,
  type WorktreeTerminalSession
} from '../../sidebar/worktree-terminal-session-order'
import {
  addTerminalManagerGroup,
  deleteTerminalManagerGroup,
  moveTerminalManagerGroup,
  moveTerminalManagerSession,
  renameTerminalManagerGroup,
  sessionsForTerminalManagerGroup,
  toggleTerminalManagerGroup
} from './terminal-manager-layout'
import {
  hasTerminalManagerGroupDrag,
  readTerminalManagerGroupDrag
} from './terminal-manager-drag-data'
import { TerminalManagerGroupSection } from './TerminalManagerGroupSection'
import { useTerminalManagerLayout } from './use-terminal-manager-layout'

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
  const worktree = useAppStore((state) => state.getKnownWorktreeById(worktreeId) ?? null)
  const completionNotificationsEnabled = useAppStore(
    (state) =>
      state.settings?.notifications.enabled === true &&
      state.settings.notifications.agentTaskComplete === true
  )
  const sessions = useMemo(
    () => orderWorktreeTerminalSessions(terminalTabs, unifiedTabs, tabGroups),
    [tabGroups, terminalTabs, unifiedTabs]
  )
  const sessionIds = useMemo(() => sessions.map((session) => session.tab.id), [sessions])
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.tab.id, session])),
    [sessions]
  )
  const [layout, setLayout] = useTerminalManagerLayout(worktreeId, sessionIds)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [isAddingGroup, setIsAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const newGroupResolvedRef = useRef(false)
  const projectName = worktree?.displayName || worktree?.branch || worktreeId

  const resolveSessions = (ids: readonly string[]): WorktreeTerminalSession[] =>
    ids.flatMap((id) => {
      const session = sessionById.get(id)
      return session ? [session] : []
    })
  const createSession = async (): Promise<void> => {
    if (isCreatingSession) {
      return
    }
    setIsCreatingSession(true)
    try {
      await createWorktreeTerminalSession(worktreeId)
    } finally {
      setIsCreatingSession(false)
    }
  }
  const beginAddGroup = (): void => {
    newGroupResolvedRef.current = false
    setNewGroupName('')
    setIsAddingGroup(true)
  }
  const commitAddGroup = (): void => {
    if (newGroupResolvedRef.current) {
      return
    }
    newGroupResolvedRef.current = true
    const name = newGroupName.trim()
    if (name) {
      setLayout((current) =>
        addTerminalManagerGroup(current, {
          id: `group-${createBrowserUuid()}`,
          name
        })
      )
    }
    setIsAddingGroup(false)
  }
  const cancelAddGroup = (): void => {
    newGroupResolvedRef.current = true
    setIsAddingGroup(false)
  }
  const moveSession = (
    sessionId: string,
    groupId: string | null,
    beforeSessionId?: string
  ): void => {
    setLayout((current) => moveTerminalManagerSession(current, sessionId, groupId, beforeSessionId))
  }
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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-terminal-manager-workspace={worktreeId}>
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xs font-semibold text-foreground">
              {translate('terminalManager.title', 'Terminal manager')}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{projectName}</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('terminalManager.newGroup', 'New group')}
                onClick={beginAddGroup}
              >
                <FolderPlus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {translate('terminalManager.newGroup', 'New group')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('terminalManager.newSession', 'New terminal session')}
                disabled={isCreatingSession}
                onClick={() => void createSession()}
              >
                {isCreatingSession ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {translate('terminalManager.newSession', 'New terminal session')}
            </TooltipContent>
          </Tooltip>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="mt-1.5 h-6 justify-start px-1.5 text-[10px] font-normal text-muted-foreground"
          aria-pressed={completionNotificationsEnabled}
          onClick={toggleCompletionNotifications}
        >
          {completionNotificationsEnabled ? (
            <BellRing className="size-3" />
          ) : (
            <BellOff className="size-3" />
          )}
          {completionNotificationsEnabled
            ? translate('terminalManager.completionNotificationsOn', 'AI completion alerts on')
            : translate('terminalManager.completionNotificationsOff', 'AI completion alerts off')}
        </Button>
        {isAddingGroup ? (
          <Input
            autoFocus
            value={newGroupName}
            aria-label={translate('terminalManager.groupName', 'Group name')}
            placeholder={translate('terminalManager.groupNamePlaceholder', 'e.g. Implementation')}
            className="mt-2 h-7 px-2 py-0 text-xs"
            maxLength={80}
            spellCheck={false}
            onChange={(event) => setNewGroupName(event.target.value)}
            onBlur={commitAddGroup}
            onKeyDown={(event) => {
              if (isImeCompositionKeyDown(event)) {
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                commitAddGroup()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelAddGroup()
              }
            }}
          />
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2 scrollbar-sleek">
        {layout.groups.map((group, index) => (
          <TerminalManagerGroupSection
            key={group.id}
            group={group}
            collapsed={group.collapsed}
            sessions={resolveSessions(sessionsForTerminalManagerGroup(layout, group.id))}
            groups={layout.groups}
            activeTerminalTabId={activeTerminalTabId}
            groupIndex={index}
            onToggle={(groupId) =>
              setLayout((current) => toggleTerminalManagerGroup(current, groupId))
            }
            onRename={(groupId, name) =>
              setLayout((current) => renameTerminalManagerGroup(current, groupId, name))
            }
            onDelete={(groupId) =>
              setLayout((current) => deleteTerminalManagerGroup(current, groupId))
            }
            onMoveGroup={(groupId, beforeGroupId) =>
              setLayout((current) => moveTerminalManagerGroup(current, groupId, beforeGroupId))
            }
            onMoveSession={moveSession}
          />
        ))}
        <div
          className="h-2 rounded transition-colors"
          data-terminal-manager-group-end-drop="true"
          onDragOver={(event) => {
            if (!hasTerminalManagerGroupDrag(event.dataTransfer)) {
              return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(event) => {
            const groupId = readTerminalManagerGroupDrag(event.dataTransfer)
            if (!groupId) {
              return
            }
            event.preventDefault()
            setLayout((current) => moveTerminalManagerGroup(current, groupId, null))
          }}
        />
        <TerminalManagerGroupSection
          group={null}
          collapsed={layout.ungroupedCollapsed}
          sessions={resolveSessions(sessionsForTerminalManagerGroup(layout, null))}
          groups={layout.groups}
          activeTerminalTabId={activeTerminalTabId}
          groupIndex={layout.groups.length}
          onToggle={() => setLayout((current) => toggleTerminalManagerGroup(current, null))}
          onRename={() => undefined}
          onDelete={() => undefined}
          onMoveGroup={() => undefined}
          onMoveSession={moveSession}
        />
      </div>
    </div>
  )
}
