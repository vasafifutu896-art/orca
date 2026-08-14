import { pointerWithin, type CollisionDetection, type UniqueIdentifier } from '@dnd-kit/core'

export type TerminalManagerDragData =
  | { kind: 'terminal-manager-session'; sessionId: string }
  | { groupId: string; kind: 'terminal-manager-group' }

export type TerminalManagerDropData =
  | { groupId: string | null; kind: 'terminal-manager-group-target' }
  | {
      beforeSessionId: string
      groupId: string | null
      kind: 'terminal-manager-session-target'
    }
  | { kind: 'terminal-manager-group-end-target' }

export function terminalManagerSessionDragId(sessionId: string): string {
  return `terminal-manager:drag:session:${sessionId}`
}

export function terminalManagerGroupDragId(groupId: string): string {
  return `terminal-manager:drag:group:${groupId}`
}

export function terminalManagerSessionDropId(sessionId: string): string {
  return `terminal-manager:drop:session:${sessionId}`
}

export function terminalManagerGroupDropId(groupId: string | null): string {
  return `terminal-manager:drop:group:${groupId ?? 'ungrouped'}`
}

export const TERMINAL_MANAGER_GROUP_END_DROP_ID = 'terminal-manager:drop:group-end'

export function readTerminalManagerDragData(value: unknown): TerminalManagerDragData | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const data = value as Record<string, unknown>
  if (data.kind === 'terminal-manager-session' && typeof data.sessionId === 'string') {
    return { kind: data.kind, sessionId: data.sessionId }
  }
  if (data.kind === 'terminal-manager-group' && typeof data.groupId === 'string') {
    return { kind: data.kind, groupId: data.groupId }
  }
  return null
}

export function readTerminalManagerDropData(value: unknown): TerminalManagerDropData | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const data = value as Record<string, unknown>
  if (data.kind === 'terminal-manager-group-end-target') {
    return { kind: data.kind }
  }
  const groupId = typeof data.groupId === 'string' ? data.groupId : null
  if (data.kind === 'terminal-manager-group-target') {
    return { kind: data.kind, groupId }
  }
  if (data.kind === 'terminal-manager-session-target' && typeof data.beforeSessionId === 'string') {
    return { kind: data.kind, groupId, beforeSessionId: data.beforeSessionId }
  }
  return null
}

function collisionPriority(
  id: UniqueIdentifier,
  containers: Parameters<CollisionDetection>[0]['droppableContainers']
): number {
  const data = readTerminalManagerDropData(
    containers.find((container) => container.id === id)?.data.current
  )
  return data?.kind === 'terminal-manager-session-target' ? 0 : 1
}

export const terminalManagerCollisionDetection: CollisionDetection = (args) => {
  const dragData = readTerminalManagerDragData(args.active.data.current)
  return pointerWithin(args)
    .filter((collision) => {
      const dropData = readTerminalManagerDropData(
        args.droppableContainers.find((container) => container.id === collision.id)?.data.current
      )
      if (!dragData || !dropData) {
        return false
      }
      return dragData.kind === 'terminal-manager-session'
        ? dropData.kind !== 'terminal-manager-group-end-target'
        : dropData.kind !== 'terminal-manager-session-target'
    })
    .sort(
      (left, right) =>
        collisionPriority(left.id, args.droppableContainers) -
        collisionPriority(right.id, args.droppableContainers)
    )
}
