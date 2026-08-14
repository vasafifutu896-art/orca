export const TERMINAL_MANAGER_SESSION_DRAG_TYPE = 'application/x-orca-terminal-session'
export const TERMINAL_MANAGER_GROUP_DRAG_TYPE = 'application/x-orca-terminal-group'

type DragDataTransfer = Pick<DataTransfer, 'getData' | 'setData' | 'types'> & {
  effectAllowed?: string
  dropEffect?: string
}

export function writeTerminalManagerSessionDrag(
  dataTransfer: DragDataTransfer,
  sessionId: string
): void {
  dataTransfer.setData(TERMINAL_MANAGER_SESSION_DRAG_TYPE, sessionId)
  dataTransfer.setData('text/plain', sessionId)
  dataTransfer.effectAllowed = 'move'
}

export function writeTerminalManagerGroupDrag(
  dataTransfer: DragDataTransfer,
  groupId: string
): void {
  dataTransfer.setData(TERMINAL_MANAGER_GROUP_DRAG_TYPE, groupId)
  dataTransfer.effectAllowed = 'move'
}

export function readTerminalManagerSessionDrag(dataTransfer: DragDataTransfer): string | null {
  const value =
    dataTransfer.getData(TERMINAL_MANAGER_SESSION_DRAG_TYPE) || dataTransfer.getData('text/plain')
  return value || null
}

export function readTerminalManagerGroupDrag(dataTransfer: DragDataTransfer): string | null {
  const value = dataTransfer.getData(TERMINAL_MANAGER_GROUP_DRAG_TYPE)
  return value || null
}

export function hasTerminalManagerSessionDrag(dataTransfer: DragDataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(TERMINAL_MANAGER_SESSION_DRAG_TYPE)
}

export function hasTerminalManagerGroupDrag(dataTransfer: DragDataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(TERMINAL_MANAGER_GROUP_DRAG_TYPE)
}
