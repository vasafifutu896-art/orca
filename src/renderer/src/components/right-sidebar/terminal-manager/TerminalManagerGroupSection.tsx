import { useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { WorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-order'
import type { TerminalManagerGroup } from './terminal-manager-layout'
import {
  hasTerminalManagerGroupDrag,
  hasTerminalManagerSessionDrag,
  readTerminalManagerGroupDrag,
  readTerminalManagerSessionDrag,
  writeTerminalManagerGroupDrag
} from './terminal-manager-drag-data'
import { TerminalManagerSessionRow } from './TerminalManagerSessionRow'

type Props = {
  group: TerminalManagerGroup | null
  collapsed: boolean
  sessions: readonly WorktreeTerminalSession[]
  groups: readonly TerminalManagerGroup[]
  activeTerminalTabId: string | null
  groupIndex: number
  onToggle: (groupId: string | null) => void
  onRename: (groupId: string, name: string) => void
  onDelete: (groupId: string) => void
  onMoveGroup: (groupId: string, beforeGroupId?: string | null) => void
  onMoveSession: (sessionId: string, groupId: string | null, beforeSessionId?: string) => void
}

export function TerminalManagerGroupSection({
  group,
  collapsed,
  sessions,
  groups,
  activeTerminalTabId,
  groupIndex,
  onToggle,
  onRename,
  onDelete,
  onMoveGroup,
  onMoveSession
}: Props): React.JSX.Element {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(group?.name ?? '')
  const [isDropTarget, setIsDropTarget] = useState(false)
  const renameResolvedRef = useRef(false)
  const groupId = group?.id ?? null
  const groupName = group?.name ?? translate('terminalManager.ungrouped', 'Ungrouped')

  const beginRename = (): void => {
    if (!group) {
      return
    }
    renameResolvedRef.current = false
    setRenameValue(group.name)
    setIsRenaming(true)
  }
  const commitRename = (): void => {
    if (!group || renameResolvedRef.current) {
      return
    }
    renameResolvedRef.current = true
    const name = renameValue.trim()
    if (name) {
      onRename(group.id, name)
    }
    setIsRenaming(false)
  }
  const cancelRename = (): void => {
    renameResolvedRef.current = true
    setIsRenaming(false)
  }
  const leaveDropTarget = (event: React.DragEvent<HTMLElement>): void => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setIsDropTarget(false)
    }
  }

  return (
    <section
      className={cn(
        'rounded-lg border border-transparent transition-colors',
        isDropTarget && 'border-ring/40 bg-accent/35'
      )}
      data-terminal-manager-group-id={groupId ?? 'ungrouped'}
      onDragOver={(event) => {
        const acceptsSession = hasTerminalManagerSessionDrag(event.dataTransfer)
        const acceptsGroup = Boolean(group && hasTerminalManagerGroupDrag(event.dataTransfer))
        if (!acceptsSession && !acceptsGroup) {
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setIsDropTarget(true)
      }}
      onDragLeave={leaveDropTarget}
      onDrop={(event) => {
        const draggedGroupId = group ? readTerminalManagerGroupDrag(event.dataTransfer) : null
        if (draggedGroupId && draggedGroupId !== group?.id) {
          event.preventDefault()
          onMoveGroup(draggedGroupId, group?.id)
          setIsDropTarget(false)
          return
        }
        const sessionId = readTerminalManagerSessionDrag(event.dataTransfer)
        if (!sessionId) {
          return
        }
        event.preventDefault()
        onMoveSession(sessionId, groupId)
        setIsDropTarget(false)
      }}
    >
      <div className="group/group flex h-8 min-w-0 items-center px-1">
        {group ? (
          <span
            className="flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/45 active:cursor-grabbing"
            draggable
            aria-label={translate('terminalManager.dragGroup', 'Drag group {{value0}}', {
              value0: group.name
            })}
            onDragStart={(event) => writeTerminalManagerGroupDrag(event.dataTransfer, group.id)}
          >
            <GripVertical className="size-3.5" aria-hidden="true" />
          </span>
        ) : (
          <span className="w-1 shrink-0" />
        )}
        {isRenaming ? (
          <Input
            autoFocus
            value={renameValue}
            aria-label={translate('terminalManager.renameGroupInput', 'Rename group {{value0}}', {
              value0: groupName
            })}
            className="h-7 min-w-0 flex-1 px-2 py-0 text-xs"
            maxLength={80}
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
            size="xs"
            className="h-7 min-w-0 flex-1 justify-start gap-1 px-1.5 text-xs font-medium hover:bg-accent/60"
            aria-expanded={!collapsed}
            onClick={() => onToggle(groupId)}
          >
            {collapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{groupName}</span>
            <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">
              {sessions.length}
            </span>
          </Button>
        )}
        {group && !isRenaming ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-6 shrink-0 opacity-0 hover:bg-accent group-hover/group:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                aria-label={translate('terminalManager.groupActions', '{{value0}} group actions', {
                  value0: group.name
                })}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={beginRename}>
                <Pencil />
                {translate('terminalManager.renameGroup', 'Rename group')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={groupIndex === 0}
                onSelect={() => onMoveGroup(group.id, groups[groupIndex - 1]?.id)}
              >
                <ArrowUp />
                {translate('terminalManager.moveGroupUp', 'Move group up')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={groupIndex === groups.length - 1}
                onSelect={() => onMoveGroup(group.id, groups[groupIndex + 2]?.id ?? null)}
              >
                <ArrowDown />
                {translate('terminalManager.moveGroupDown', 'Move group down')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(group.id)}>
                <Trash2 />
                {translate('terminalManager.deleteGroup', 'Delete group')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="space-y-0.5 px-1 pb-1">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <TerminalManagerSessionRow
                key={session.tab.id}
                session={session}
                isActive={activeTerminalTabId === session.tab.id}
                groupId={groupId}
                groups={groups}
                onMove={onMoveSession}
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
