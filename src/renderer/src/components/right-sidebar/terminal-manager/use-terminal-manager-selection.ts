import { useMemo, useState } from 'react'
import {
  normalizeTerminalManagerSelection,
  resolveTerminalManagerSelection,
  terminalManagerSessionIdsForBatchAction,
  type TerminalManagerSelectionGesture,
  type TerminalManagerSelectionState
} from './terminal-manager-selection'

const EMPTY_SELECTION: TerminalManagerSelectionState = { anchorId: null, selectedIds: [] }

export type TerminalManagerSelection = {
  clear: () => void
  isSelected: (sessionId: string) => boolean
  prepareBatchAction: (sourceSessionId: string) => string[]
  select: (sessionId: string, gesture: TerminalManagerSelectionGesture) => void
  selectedIds: readonly string[]
  toggle: (sessionId: string) => void
}

export function useTerminalManagerSelection(
  orderedSessionIds: readonly string[]
): TerminalManagerSelection {
  const [state, setState] = useState<TerminalManagerSelectionState>(EMPTY_SELECTION)
  const normalized = useMemo(
    () => normalizeTerminalManagerSelection(orderedSessionIds, state),
    [orderedSessionIds, state]
  )
  const selectedSet = useMemo(() => new Set(normalized.selectedIds), [normalized.selectedIds])

  return {
    clear: () => setState(EMPTY_SELECTION),
    isSelected: (sessionId) => selectedSet.has(sessionId),
    prepareBatchAction: (sourceSessionId) => {
      const sessionIds = terminalManagerSessionIdsForBatchAction(
        orderedSessionIds,
        normalized.selectedIds,
        sourceSessionId
      )
      if (!selectedSet.has(sourceSessionId)) {
        setState({ anchorId: sourceSessionId, selectedIds: [sourceSessionId] })
      }
      return sessionIds
    },
    select: (sessionId, gesture) =>
      setState((current) =>
        resolveTerminalManagerSelection(orderedSessionIds, current, sessionId, gesture)
      ),
    selectedIds: normalized.selectedIds,
    toggle: (sessionId) =>
      setState((current) =>
        resolveTerminalManagerSelection(orderedSessionIds, current, sessionId, {
          additive: true,
          range: false
        })
      )
  }
}
