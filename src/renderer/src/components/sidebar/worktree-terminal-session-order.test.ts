import { describe, expect, it } from 'vitest'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { orderWorktreeTerminalSessions } from './worktree-terminal-session-order'

function terminal(id: string, sortOrder: number): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId: 'worktree-1',
    title: id,
    customTitle: null,
    color: null,
    sortOrder,
    createdAt: sortOrder
  }
}

function unified(id: string, entityId: string, groupId: string): Tab {
  return {
    id,
    entityId,
    groupId,
    worktreeId: 'worktree-1',
    contentType: 'terminal',
    label: entityId,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function group(id: string, tabOrder: string[]): TabGroup {
  return { id, worktreeId: 'worktree-1', activeTabId: tabOrder[0] ?? null, tabOrder }
}

describe('orderWorktreeTerminalSessions', () => {
  it('uses pane-group tab order before legacy terminal sort order', () => {
    const tabs = [terminal('terminal-a', 0), terminal('terminal-b', 1)]
    const unifiedTabs = [
      unified('unified-a', 'terminal-a', 'group-1'),
      unified('unified-b', 'terminal-b', 'group-1')
    ]

    const result = orderWorktreeTerminalSessions(tabs, unifiedTabs, [
      group('group-1', ['unified-b', 'unified-a'])
    ])

    expect(result.map((session) => session.tab.id)).toEqual(['terminal-b', 'terminal-a'])
  })

  it('appends legacy sessions that have not reconciled into the unified model', () => {
    const tabs = [terminal('terminal-a', 2), terminal('terminal-b', 1)]
    const unifiedTabs = [unified('unified-a', 'terminal-a', 'group-1')]

    const result = orderWorktreeTerminalSessions(tabs, unifiedTabs, [
      group('group-1', ['unified-a'])
    ])

    expect(result.map((session) => session.tab.id)).toEqual(['terminal-a', 'terminal-b'])
    expect(result[1]?.unifiedTab).toBeNull()
  })
})
