// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openSshServerSession: vi.fn(),
  focusTerminalTabSurface: vi.fn(),
  recordFeatureInteraction: vi.fn(),
  openSettingsTarget: vi.fn(),
  openSettingsPage: vi.fn()
}))

const storeState = {
  sshTargetLabels: new Map([['ssh-1', 'Builder']]),
  sshConnectionStates: new Map(),
  sshTargetsHydrated: true,
  recordFeatureInteraction: mocks.recordFeatureInteraction,
  openSettingsTarget: mocks.openSettingsTarget,
  openSettingsPage: mocks.openSettingsPage
}

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
  return { useAppStore }
})

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/settings/SshTargetCard', () => ({
  statusColor: () => 'bg-muted-foreground'
}))

vi.mock('./AddRemoteHostDialog', () => ({ AddRemoteHostDialog: () => null }))
vi.mock('./ssh-server-session', () => ({
  openSshServerSession: (...args: unknown[]) => mocks.openSshServerSession(...args)
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: (...args: unknown[]) => mocks.focusTerminalTabSurface(...args)
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealFolderWorkspace: vi.fn() }))

import { SshServersPanel } from './SshServersPanel'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.openSshServerSession.mockResolvedValue({
    folderWorkspaceId: 'folder-1',
    tabId: 'tab-1'
  })
})

afterEach(() => cleanup())

describe('SshServersPanel', () => {
  it('opens a registered server only on double-click and focuses its terminal', async () => {
    const user = userEvent.setup()
    render(<SshServersPanel />)
    const row = screen.getByRole('button', { name: /Builder/ })

    await user.click(row)
    expect(mocks.openSshServerSession).not.toHaveBeenCalled()

    await user.dblClick(row)
    await waitFor(() => expect(mocks.openSshServerSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('tab-1'))
  })
})
