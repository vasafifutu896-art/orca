import { useCallback, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
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
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { terminalManagerGroupDragId, type TerminalManagerDragData } from './terminal-manager-dnd'
import type { TerminalManagerGroup } from './terminal-manager-layout'

type Props = {
  collapsed: boolean
  group: TerminalManagerGroup | null
  groupIndex: number
  groups: readonly TerminalManagerGroup[]
  onDelete: (groupId: string) => void
  onMoveGroup: (groupId: string, beforeGroupId?: string | null) => void
  onRename: (groupId: string, name: string) => void
  onToggle: (groupId: string | null) => void
  sessionCount: number
}

function TerminalManagerGroupDragHandle({
  group
}: {
  group: TerminalManagerGroup
}): React.JSX.Element {
  const dragData: TerminalManagerDragData = { kind: 'terminal-manager-group', groupId: group.id }
  const { attributes, listeners, setActivatorNodeRef, setNodeRef } = useDraggable({
    id: terminalManagerGroupDragId(group.id),
    data: dragData
  })
  return (
    <button
      ref={(node) => {
        setNodeRef(node)
        setActivatorNodeRef(node)
      }}
      type="button"
      className="flex size-5 shrink-0 touch-none cursor-grab items-center justify-center text-muted-foreground/45 outline-none active:cursor-grabbing focus-visible:text-foreground"
      aria-label={translate('terminalManager.dragGroup', 'Drag group {{value0}}', {
        value0: group.name
      })}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" aria-hidden="true" />
    </button>
  )
}

export function TerminalManagerGroupHeader({
  collapsed,
  group,
  groupIndex,
  groups,
  onDelete,
  onMoveGroup,
  onRename,
  onToggle,
  sessionCount
}: Props): React.JSX.Element {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(group?.name ?? '')
  const renameResolvedRef = useRef(false)
  const renameFocusFrameRef = useRef<number | null>(null)
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
  const setRenameInputElement = useCallback((input: HTMLInputElement | null) => {
    if (renameFocusFrameRef.current !== null) {
      cancelAnimationFrame(renameFocusFrameRef.current)
      renameFocusFrameRef.current = null
    }
    if (!input) {
      return
    }
    // Radix restores focus while closing its menu; focus after teardown so blur cannot commit early.
    renameFocusFrameRef.current = requestAnimationFrame(() => {
      renameFocusFrameRef.current = null
      input.focus()
      input.select()
    })
  }, [])

  const header = (
    <div className="group/group flex h-8 min-w-0 items-center px-1">
      {group ? <TerminalManagerGroupDragHandle group={group} /> : <span className="w-1" />}
      {isRenaming ? (
        <Input
          ref={setRenameInputElement}
          value={renameValue}
          aria-label={translate('terminalManager.renameGroupInput', 'Rename group {{value0}}', {
            value0: groupName
          })}
          className="h-7 min-w-0 flex-1 px-2 py-0 text-xs"
          maxLength={80}
          spellCheck={false}
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
            {sessionCount}
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
  )

  if (!group) {
    return header
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={beginRename}>
          <Pencil />
          {translate('terminalManager.renameGroup', 'Rename group')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
