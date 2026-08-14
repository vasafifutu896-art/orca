import { useDroppable } from '@dnd-kit/core'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { WorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-order'
import { terminalManagerGroupDropId, type TerminalManagerDropData } from './terminal-manager-dnd'
import type { TerminalManagerGroup } from './terminal-manager-layout'
import type { TerminalManagerSelectionGesture } from './terminal-manager-selection'
import { TerminalManagerGroupHeader } from './TerminalManagerGroupHeader'
import { TerminalManagerSessionRow } from './TerminalManagerSessionRow'

type Props = {
  activeTerminalTabId: string | null
  collapsed: boolean
  group: TerminalManagerGroup | null
  groupIndex: number
  groups: readonly TerminalManagerGroup[]
  isSessionSelected: (sessionId: string) => boolean
  onDelete: (groupId: string) => void
  onMoveGroup: (groupId: string, beforeGroupId?: string | null) => void
  onMoveSession: (sessionId: string, groupId: string | null, beforeSessionId?: string) => void
  onRename: (groupId: string, name: string) => void
  onSelectSession: (sessionId: string, gesture: TerminalManagerSelectionGesture) => void
  onToggle: (groupId: string | null) => void
  sessions: readonly WorktreeTerminalSession[]
}

export function TerminalManagerGroupSection({
  activeTerminalTabId,
  collapsed,
  group,
  groupIndex,
  groups,
  isSessionSelected,
  onDelete,
  onMoveGroup,
  onMoveSession,
  onRename,
  onSelectSession,
  onToggle,
  sessions
}: Props): React.JSX.Element {
  const groupId = group?.id ?? null
  const dropData: TerminalManagerDropData = {
    kind: 'terminal-manager-group-target',
    groupId
  }
  const { isOver, setNodeRef } = useDroppable({
    id: terminalManagerGroupDropId(groupId),
    data: dropData
  })

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'rounded-lg border border-transparent transition-colors',
        isOver && 'border-ring/40 bg-accent/35'
      )}
      data-terminal-manager-group-id={groupId ?? 'ungrouped'}
      data-terminal-manager-group-drop-target="true"
    >
      <TerminalManagerGroupHeader
        group={group}
        collapsed={collapsed}
        sessionCount={sessions.length}
        groups={groups}
        groupIndex={groupIndex}
        onToggle={onToggle}
        onRename={onRename}
        onDelete={onDelete}
        onMoveGroup={onMoveGroup}
      />
      {!collapsed ? (
        <div className="space-y-0.5 px-1 pb-1">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <TerminalManagerSessionRow
                key={session.tab.id}
                session={session}
                isActive={activeTerminalTabId === session.tab.id}
                isSelected={isSessionSelected(session.tab.id)}
                groupId={groupId}
                groups={groups}
                onMove={onMoveSession}
                onSelect={onSelectSession}
              />
            ))
          ) : (
            <div
              className="flex h-10 items-center justify-center rounded-md border border-dashed border-border/60 px-3 text-center text-[11px] text-muted-foreground/70"
              data-terminal-manager-empty-group="true"
            >
              {translate('terminalManager.dropHere', 'Drop terminal sessions here')}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
