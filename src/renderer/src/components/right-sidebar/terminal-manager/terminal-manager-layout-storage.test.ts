import { describe, expect, it, vi } from 'vitest'
import { createEmptyTerminalManagerLayout } from './terminal-manager-layout'
import {
  loadTerminalManagerLayout,
  saveTerminalManagerLayout,
  terminalManagerLayoutStorageKey
} from './terminal-manager-layout-storage'

describe('terminal manager layout storage', () => {
  it('round-trips a workspace layout under an encoded project key', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
    const layout = createEmptyTerminalManagerLayout(['one'])

    expect(saveTerminalManagerLayout('ssh:server/C:\\repo', layout, storage)).toBe(true)
    expect(terminalManagerLayoutStorageKey('ssh:server/C:\\repo')).not.toContain('C:\\repo')
    expect(loadTerminalManagerLayout('ssh:server/C:\\repo', ['one'], storage)).toEqual(layout)
  })

  it('fails closed when storage contains invalid JSON or throws', () => {
    const invalidStorage = {
      getItem: () => '{broken',
      setItem: vi.fn(() => {
        throw new Error('quota')
      })
    }

    expect(loadTerminalManagerLayout('project', ['one'], invalidStorage)).toEqual(
      createEmptyTerminalManagerLayout(['one'])
    )
    expect(
      saveTerminalManagerLayout(
        'project',
        createEmptyTerminalManagerLayout(['one']),
        invalidStorage
      )
    ).toBe(false)
  })
})
