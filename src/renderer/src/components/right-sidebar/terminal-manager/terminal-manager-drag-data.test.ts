import { describe, expect, it } from 'vitest'
import {
  hasTerminalManagerGroupDrag,
  hasTerminalManagerSessionDrag,
  readTerminalManagerGroupDrag,
  readTerminalManagerSessionDrag,
  TERMINAL_MANAGER_GROUP_DRAG_TYPE,
  TERMINAL_MANAGER_SESSION_DRAG_TYPE,
  writeTerminalManagerGroupDrag,
  writeTerminalManagerSessionDrag
} from './terminal-manager-drag-data'

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  const transfer = {
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => {
      values.set(type, value)
    },
    get types() {
      return [...values.keys()]
    }
  }
  return transfer as unknown as DataTransfer
}

describe('terminal manager drag data', () => {
  it('round-trips a terminal session drag payload', () => {
    const transfer = createDataTransfer()

    writeTerminalManagerSessionDrag(transfer, 'terminal-1')

    expect(transfer.effectAllowed).toBe('move')
    expect(transfer.getData(TERMINAL_MANAGER_SESSION_DRAG_TYPE)).toBe('terminal-1')
    expect(transfer.getData('text/plain')).toBe('terminal-1')
    expect(hasTerminalManagerSessionDrag(transfer)).toBe(true)
    expect(readTerminalManagerSessionDrag(transfer)).toBe('terminal-1')
    expect(hasTerminalManagerGroupDrag(transfer)).toBe(false)
  })

  it('round-trips a terminal group drag payload', () => {
    const transfer = createDataTransfer()

    writeTerminalManagerGroupDrag(transfer, 'group-1')

    expect(transfer.effectAllowed).toBe('move')
    expect(transfer.getData(TERMINAL_MANAGER_GROUP_DRAG_TYPE)).toBe('group-1')
    expect(hasTerminalManagerGroupDrag(transfer)).toBe(true)
    expect(readTerminalManagerGroupDrag(transfer)).toBe('group-1')
    expect(hasTerminalManagerSessionDrag(transfer)).toBe(false)
  })

  it('reads the plain-text fallback when Electron strips custom drag data', () => {
    const transfer = createDataTransfer()
    transfer.setData(TERMINAL_MANAGER_SESSION_DRAG_TYPE, '')
    transfer.setData('text/plain', 'terminal-fallback')

    expect(readTerminalManagerSessionDrag(transfer)).toBe('terminal-fallback')
  })
})
