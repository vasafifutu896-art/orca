import { useCallback, useRef, useState } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  readTerminalManagerDragData,
  readTerminalManagerDropData,
  terminalManagerCollisionDetection
} from './terminal-manager-dnd'

type ActiveTerminalManagerDrag =
  | { kind: 'group'; groupId: string }
  | { kind: 'sessions'; sessionIds: readonly string[] }

type Options = {
  moveGroup: (groupId: string, beforeGroupId?: string | null) => void
  moveSessions: (
    sessionIds: readonly string[],
    groupId: string | null,
    beforeSessionId?: string
  ) => void
  prepareSessionDrag: (sessionId: string) => string[]
}

export function useTerminalManagerDnd(options: Options): {
  activeDrag: ActiveTerminalManagerDrag | null
  collisionDetection: typeof terminalManagerCollisionDetection
  onDragCancel: () => void
  onDragEnd: (event: DragEndEvent) => void
  onDragStart: (event: DragStartEvent) => void
  sensors: ReturnType<typeof useSensors>
} {
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  const keyboardSensor = useSensor(KeyboardSensor)
  const sensors = useSensors(pointerSensor, keyboardSensor)
  const [activeDrag, setActiveDrag] = useState<ActiveTerminalManagerDrag | null>(null)
  const activeDragRef = useRef<ActiveTerminalManagerDrag | null>(null)

  const clearActiveDrag = useCallback(() => {
    activeDragRef.current = null
    setActiveDrag(null)
  }, [])
  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = readTerminalManagerDragData(event.active.data.current)
      if (!data) {
        return
      }
      const next: ActiveTerminalManagerDrag =
        data.kind === 'terminal-manager-session'
          ? { kind: 'sessions', sessionIds: options.prepareSessionDrag(data.sessionId) }
          : { kind: 'group', groupId: data.groupId }
      activeDragRef.current = next
      setActiveDrag(next)
    },
    [options]
  )
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const active = activeDragRef.current
      const drop = readTerminalManagerDropData(event.over?.data.current)
      clearActiveDrag()
      if (!active || !drop) {
        return
      }
      if (active.kind === 'group') {
        if (drop.kind === 'terminal-manager-group-end-target') {
          options.moveGroup(active.groupId, null)
        } else if (drop.kind === 'terminal-manager-group-target' && drop.groupId) {
          options.moveGroup(active.groupId, drop.groupId)
        }
        return
      }
      if (drop.kind === 'terminal-manager-session-target') {
        options.moveSessions(active.sessionIds, drop.groupId, drop.beforeSessionId)
      } else if (drop.kind === 'terminal-manager-group-target') {
        options.moveSessions(active.sessionIds, drop.groupId)
      }
    },
    [clearActiveDrag, options]
  )

  return {
    activeDrag,
    collisionDetection: terminalManagerCollisionDetection,
    onDragCancel: clearActiveDrag,
    onDragEnd,
    onDragStart,
    sensors
  }
}
