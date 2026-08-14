import type { ReactElement } from 'react'
import { Check, FolderInput, Pencil, Pin, PinOff, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
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
import type { TerminalManagerGroup } from './terminal-manager-layout'

type Props = {
  children: ReactElement
  groupId: string | null
  groups: readonly TerminalManagerGroup[]
  isPinned: boolean
  onClose: () => void
  onMove: (groupId: string | null) => void
  onRename: () => void
  onTogglePin: () => void
  pinDisabled: boolean
}

export function TerminalManagerSessionContextMenu({
  children,
  groupId,
  groups,
  isPinned,
  onClose,
  onMove,
  onRename,
  onTogglePin,
  pinDisabled
}: Props): React.JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onRename}>
          <Pencil />
          {translate('terminalManager.renameSession', 'Rename session')}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput />
            {translate('terminalManager.moveToGroup', 'Move to group')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => onMove(null)}>
              {groupId === null ? <Check /> : <span className="size-3.5" />}
              {translate('terminalManager.ungrouped', 'Ungrouped')}
            </ContextMenuItem>
            {groups.map((group) => (
              <ContextMenuItem key={group.id} onSelect={() => onMove(group.id)}>
                {groupId === group.id ? <Check /> : <span className="size-3.5" />}
                {group.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={onTogglePin} disabled={pinDisabled}>
          {isPinned ? <PinOff /> : <Pin />}
          {isPinned
            ? translate('terminalManager.unpin', 'Unpin session')
            : translate('terminalManager.pin', 'Pin session')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onClose} disabled={isPinned} variant="destructive">
          <X />
          {translate('terminalManager.closeSession', 'Close session')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
