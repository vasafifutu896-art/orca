export type TerminalManagerSelectionGesture = {
  additive: boolean
  range: boolean
}

export type TerminalManagerSelectionState = {
  anchorId: string | null
  selectedIds: string[]
}

function orderedVisibleSelection(
  orderedSessionIds: readonly string[],
  selectedIds: Iterable<string>
): string[] {
  const selected = new Set(selectedIds)
  return orderedSessionIds.filter((id) => selected.has(id))
}

export function normalizeTerminalManagerSelection(
  orderedSessionIds: readonly string[],
  state: TerminalManagerSelectionState
): TerminalManagerSelectionState {
  const selectedIds = orderedVisibleSelection(orderedSessionIds, state.selectedIds)
  return {
    anchorId: state.anchorId && orderedSessionIds.includes(state.anchorId) ? state.anchorId : null,
    selectedIds
  }
}

export function resolveTerminalManagerSelection(
  orderedSessionIds: readonly string[],
  state: TerminalManagerSelectionState,
  targetId: string,
  gesture: TerminalManagerSelectionGesture
): TerminalManagerSelectionState {
  if (!orderedSessionIds.includes(targetId)) {
    return normalizeTerminalManagerSelection(orderedSessionIds, state)
  }
  const current = normalizeTerminalManagerSelection(orderedSessionIds, state)
  if (gesture.range && current.anchorId) {
    const anchorIndex = orderedSessionIds.indexOf(current.anchorId)
    const targetIndex = orderedSessionIds.indexOf(targetId)
    const firstIndex = Math.min(anchorIndex, targetIndex)
    const lastIndex = Math.max(anchorIndex, targetIndex)
    const rangeIds = orderedSessionIds.slice(firstIndex, lastIndex + 1)
    return {
      anchorId: current.anchorId,
      selectedIds: gesture.additive
        ? orderedVisibleSelection(orderedSessionIds, [...current.selectedIds, ...rangeIds])
        : rangeIds
    }
  }
  if (gesture.additive) {
    const selected = new Set(current.selectedIds)
    if (selected.has(targetId)) {
      selected.delete(targetId)
    } else {
      selected.add(targetId)
    }
    return { anchorId: targetId, selectedIds: orderedVisibleSelection(orderedSessionIds, selected) }
  }
  return { anchorId: targetId, selectedIds: [targetId] }
}

export function terminalManagerSessionIdsForBatchAction(
  orderedSessionIds: readonly string[],
  selectedIds: readonly string[],
  sourceSessionId: string
): string[] {
  const visibleSelectedIds = orderedVisibleSelection(orderedSessionIds, selectedIds)
  return visibleSelectedIds.includes(sourceSessionId) ? visibleSelectedIds : [sourceSessionId]
}
