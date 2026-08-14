import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import {
  TERMINAL_MANAGER_GROUP_END_DROP_ID,
  type TerminalManagerDropData
} from './terminal-manager-dnd'

export function TerminalManagerGroupEndDropTarget(): React.JSX.Element {
  const dropData: TerminalManagerDropData = { kind: 'terminal-manager-group-end-target' }
  const { isOver, setNodeRef } = useDroppable({
    id: TERMINAL_MANAGER_GROUP_END_DROP_ID,
    data: dropData
  })
  return (
    <div
      ref={setNodeRef}
      className={cn('h-2 rounded transition-colors', isOver && 'bg-ring/35')}
      data-terminal-manager-group-end-drop="true"
    />
  )
}
