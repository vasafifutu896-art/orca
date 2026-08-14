import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createWorktreeTerminalSession } from './worktree-terminal-session-activation'
import { orderWorktreeTerminalSessions } from './worktree-terminal-session-order'
import { WorktreeTerminalSessionRow } from './WorktreeTerminalSessionRow'

const EMPTY_TERMINAL_TABS: readonly TerminalTab[] = []
const EMPTY_UNIFIED_TABS = [] as const
const EMPTY_TAB_GROUPS = [] as const

function stopProjectCardInteraction(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

export function WorktreeTerminalSessions({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const terminalTabs = useAppStore(
    (state) => state.tabsByWorktree[worktreeId] ?? EMPTY_TERMINAL_TABS
  )
  const unifiedTabs = useAppStore(
    (state) => state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS
  )
  const groups = useAppStore((state) => state.groupsByWorktree[worktreeId] ?? EMPTY_TAB_GROUPS)
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const activeTabId = useAppStore((state) => state.activeTabId)
  const activeTabType = useAppStore((state) => state.activeTabType)
  const collapseKey = `terminal-sessions:${worktreeId}`
  const isCollapsed = useAppStore((state) => state.collapsedGroups.has(collapseKey))
  const toggleCollapsedGroup = useAppStore((state) => state.toggleCollapsedGroup)
  const [isCreating, setIsCreating] = useState(false)
  const sessions = useMemo(
    () => orderWorktreeTerminalSessions(terminalTabs, unifiedTabs, groups),
    [groups, terminalTabs, unifiedTabs]
  )
  const isActiveProject = activeWorktreeId === worktreeId

  if (sessions.length === 0 && !isActiveProject) {
    return null
  }

  const createSession = async (): Promise<void> => {
    if (isCreating) {
      return
    }
    setIsCreating(true)
    try {
      await createWorktreeTerminalSession(worktreeId)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div
      className="mt-1 border-t border-sidebar-border/70 pt-1"
      role="group"
      aria-label={translate('sidebarTerminalSessions.title', 'Terminal sessions')}
      onClick={stopProjectCardInteraction}
      onDoubleClick={stopProjectCardInteraction}
      onPointerDown={stopProjectCardInteraction}
      onContextMenu={stopProjectCardInteraction}
      onDragStart={stopProjectCardInteraction}
    >
      <div className="flex h-7 min-w-0 items-center pl-3 pr-0.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 min-w-0 flex-1 justify-start gap-1 px-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-expanded={!isCollapsed}
          onClick={() => toggleCollapsedGroup(collapseKey)}
        >
          {isCollapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          <span className="truncate">
            {translate('sidebarTerminalSessions.title', 'Terminal sessions')}
          </span>
          <span className="ml-auto tabular-nums text-muted-foreground/80">{sessions.length}</span>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-6 shrink-0 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label={translate('sidebarTerminalSessions.newSession', 'New terminal session')}
              disabled={isCreating}
              onClick={() => void createSession()}
            >
              {isCreating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('sidebarTerminalSessions.newSession', 'New terminal session')}
          </TooltipContent>
        </Tooltip>
      </div>
      {!isCollapsed && sessions.length > 0 ? (
        <div className="space-y-0.5 pb-0.5 pl-5 pr-0.5">
          {sessions.map((session) => (
            <WorktreeTerminalSessionRow
              key={session.tab.id}
              session={session}
              isActive={
                isActiveProject && activeTabType === 'terminal' && activeTabId === session.tab.id
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
