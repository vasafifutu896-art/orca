import { describe, expect, it } from 'vitest'
import {
  normalizeTerminalManagerSelection,
  resolveTerminalManagerSelection,
  terminalManagerSessionIdsForBatchAction,
  type TerminalManagerSelectionState
} from './terminal-manager-selection'

const order = ['one', 'two', 'three', 'four']

describe('terminal manager selection', () => {
  it('supports additive toggles and shift ranges in visible order', () => {
    let state: TerminalManagerSelectionState = { anchorId: null, selectedIds: [] }
    state = resolveTerminalManagerSelection(order, state, 'two', {
      additive: false,
      range: false
    })
    state = resolveTerminalManagerSelection(order, state, 'four', {
      additive: false,
      range: true
    })
    expect(state).toEqual({ anchorId: 'two', selectedIds: ['two', 'three', 'four'] })

    state = resolveTerminalManagerSelection(order, state, 'three', {
      additive: true,
      range: false
    })
    expect(state).toEqual({ anchorId: 'three', selectedIds: ['two', 'four'] })
  })

  it('moves the full visible selection only when dragging a selected session', () => {
    expect(terminalManagerSessionIdsForBatchAction(order, ['one', 'three'], 'three')).toEqual([
      'one',
      'three'
    ])
    expect(terminalManagerSessionIdsForBatchAction(order, ['one', 'three'], 'two')).toEqual(['two'])
  })

  it('drops closed sessions and stale range anchors', () => {
    expect(
      normalizeTerminalManagerSelection(['one', 'three'], {
        anchorId: 'two',
        selectedIds: ['one', 'two']
      })
    ).toEqual({ anchorId: null, selectedIds: ['one'] })
  })
})
