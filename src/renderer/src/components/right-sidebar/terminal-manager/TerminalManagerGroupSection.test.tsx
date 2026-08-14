// @vitest-environment happy-dom

import { DndContext } from '@dnd-kit/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalManagerGroupHeader } from './TerminalManagerGroupHeader'

describe('TerminalManagerGroupHeader', () => {
  it('keeps the rename editor focused after the actions menu closes and commits the name', async () => {
    const group = { id: 'group-1', name: 'Implementation', collapsed: false }
    const onRename = vi.fn()
    const user = userEvent.setup()
    render(
      <DndContext>
        <TerminalManagerGroupHeader
          group={group}
          collapsed={false}
          sessionCount={0}
          groups={[group]}
          groupIndex={0}
          onToggle={vi.fn()}
          onRename={onRename}
          onDelete={vi.fn()}
          onMoveGroup={vi.fn()}
        />
      </DndContext>
    )

    await user.click(screen.getByRole('button', { name: 'Implementation group actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename group' }))
    const input = await screen.findByRole('textbox', { name: 'Rename group Implementation' })
    await user.clear(input)
    await user.type(input, 'Core work{Enter}')

    expect(onRename).toHaveBeenCalledWith('group-1', 'Core work')
  })
})
