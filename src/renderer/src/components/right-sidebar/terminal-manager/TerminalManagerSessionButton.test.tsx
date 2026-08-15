// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { TerminalManagerSessionButton } from './TerminalManagerSessionButton'

vi.mock('../../tab-bar/TerminalTabLeadingIcon', () => ({
  TerminalTabLeadingIcon: () => <span data-testid="leading-icon" />
}))

afterEach(cleanup)

const tab: TerminalTab = {
  id: 'tab-1',
  ptyId: 'pty-1',
  worktreeId: 'repo::/workspace',
  title: 'API documentation',
  customTitle: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
}

function renderButton(workingDirectory: string | null): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <TerminalManagerSessionButton
        activityStatus="inactive"
        displayTitle="API documentation"
        isActive={false}
        isPinned={false}
        isSelected={false}
        onAuxClick={vi.fn()}
        onClick={vi.fn()}
        onDoubleClick={vi.fn()}
        showUnreadActivity={false}
        tab={tab}
        tabAgent={null}
        workingDirectory={workingDirectory}
      />
    </TooltipProvider>
  )
}

describe('TerminalManagerSessionButton', () => {
  it('shows a compact second-line cwd and exposes the full path in a tooltip', async () => {
    const user = userEvent.setup()
    renderButton('/Users/ada/repo/packages/api')

    expect(screen.getByText('API documentation')).toBeInTheDocument()
    expect(screen.getByText('…/packages/api')).toHaveAttribute(
      'data-terminal-manager-session-cwd',
      'true'
    )

    await user.hover(screen.getByRole('button', { name: 'API documentation' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('/Users/ada/repo/packages/api')
  })

  it('updates the cwd line without changing the session button identity', () => {
    const view = renderButton('C:\\work\\orca\\apps\\web')
    const button = screen.getByRole('button', { name: 'API documentation' })
    expect(screen.getByText('…\\apps\\web')).toBeInTheDocument()

    view.rerender(
      <TooltipProvider>
        <TerminalManagerSessionButton
          activityStatus="inactive"
          displayTitle="API documentation"
          isActive={false}
          isPinned={false}
          isSelected
          onAuxClick={vi.fn()}
          onClick={vi.fn()}
          onDoubleClick={vi.fn()}
          showUnreadActivity={false}
          tab={tab}
          tabAgent={null}
          workingDirectory="C:\\work\\orca\\services\\api"
        />
      </TooltipProvider>
    )

    expect(screen.getByRole('button', { name: 'API documentation' })).toBe(button)
    expect(screen.getByText('…\\services\\api')).toBeInTheDocument()
  })

  it('preserves selection state and forwards the existing session gestures', () => {
    const onClick = vi.fn()
    const onDoubleClick = vi.fn()
    const onAuxClick = vi.fn()
    render(
      <TooltipProvider>
        <TerminalManagerSessionButton
          activityStatus="inactive"
          displayTitle="API documentation"
          isActive
          isPinned={false}
          isSelected
          onAuxClick={onAuxClick}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          showUnreadActivity={false}
          tab={tab}
          tabAgent={null}
          workingDirectory="/repo/packages/api"
        />
      </TooltipProvider>
    )
    const button = screen.getByRole('button', { name: 'API documentation' })

    fireEvent.click(button, { ctrlKey: true })
    fireEvent.doubleClick(button)
    fireEvent(button, new MouseEvent('auxclick', { bubbles: true, button: 1 }))

    expect(button).toHaveAttribute('aria-current', 'page')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(onClick.mock.calls[0]?.[0]).toMatchObject({ ctrlKey: true })
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
    expect(onAuxClick).toHaveBeenCalledTimes(1)
  })
})
