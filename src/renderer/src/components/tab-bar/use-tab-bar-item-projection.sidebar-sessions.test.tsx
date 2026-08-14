// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TabBarProps } from './tab-bar-props'
import { useTabBarItemProjection } from './use-tab-bar-item-projection'

const terminal: TerminalTab = {
  id: 'terminal-1',
  ptyId: null,
  worktreeId: 'worktree-1',
  title: 'Codex',
  customTitle: null,
  color: null,
  sortOrder: 0,
  createdAt: 0
}

const unifiedTerminal: Tab = {
  id: 'unified-terminal-1',
  entityId: terminal.id,
  groupId: 'group-1',
  worktreeId: terminal.worktreeId,
  contentType: 'terminal',
  label: terminal.title,
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 0
}

function props(showTerminalTabs: boolean): TabBarProps {
  return {
    tabs: [{ ...terminal, unifiedTabId: unifiedTerminal.id }],
    activeTabId: terminal.id,
    worktreeId: terminal.worktreeId,
    expandedPaneByTabId: {},
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseToRight: vi.fn(),
    onCloseToLeft: vi.fn(),
    onNewTerminalTab: vi.fn(),
    onNewBrowserTab: vi.fn(),
    onSetCustomTitle: vi.fn(),
    onSetTabColor: vi.fn(),
    onTogglePaneExpand: vi.fn(),
    activeTabType: 'terminal',
    showTerminalTabs
  }
}

describe('useTabBarItemProjection sidebar terminal sessions', () => {
  it('removes terminal chips from the top strip in workspace sidebar mode', () => {
    const { result } = renderHook(() =>
      useTabBarItemProjection({
        props: props(false),
        resolvedGroupId: 'group-1',
        unifiedTabs: [unifiedTerminal],
        unifiedTabByVisibleId: new Map([[terminal.id, unifiedTerminal]]),
        generatedTabTitlesEnabled: false,
        statusByRelativePath: new Map()
      })
    )

    expect(result.current.orderedItems).toEqual([])
    expect(result.current.activeVisibleTabId).toBeNull()
  })

  it('keeps terminal chips for floating terminal windows', () => {
    const { result } = renderHook(() =>
      useTabBarItemProjection({
        props: props(true),
        resolvedGroupId: 'group-1',
        unifiedTabs: [unifiedTerminal],
        unifiedTabByVisibleId: new Map([[terminal.id, unifiedTerminal]]),
        generatedTabTitlesEnabled: false,
        statusByRelativePath: new Map()
      })
    )

    expect(result.current.orderedItems.map((item) => item.id)).toEqual([terminal.id])
  })
})
