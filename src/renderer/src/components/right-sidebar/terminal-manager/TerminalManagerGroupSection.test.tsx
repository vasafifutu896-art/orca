// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TERMINAL_MANAGER_SESSION_DRAG_TYPE } from './terminal-manager-drag-data'
import { TerminalManagerGroupSection } from './TerminalManagerGroupSection'

describe('TerminalManagerGroupSection', () => {
  it('moves a dropped terminal session into the group', () => {
    const onMoveSession = vi.fn()
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'move',
      types: [TERMINAL_MANAGER_SESSION_DRAG_TYPE, 'text/plain'],
      getData: (type: string) => (type === 'text/plain' ? 'terminal-1' : ''),
      setData: vi.fn()
    }
    const group = { id: 'group-1', name: 'Implementation', collapsed: false }
    const view = render(
      <TerminalManagerGroupSection
        group={group}
        collapsed={false}
        sessions={[]}
        groups={[group]}
        activeTerminalTabId={null}
        groupIndex={0}
        onToggle={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onMoveGroup={vi.fn()}
        onMoveSession={onMoveSession}
      />
    )
    const section = view.container.querySelector('[data-terminal-manager-group-id="group-1"]')
    if (!section) {
      throw new Error('Expected terminal manager group section')
    }

    fireEvent.dragOver(section, { dataTransfer })
    fireEvent.drop(section, { dataTransfer })

    expect(onMoveSession).toHaveBeenCalledWith('terminal-1', 'group-1')
  })
})
