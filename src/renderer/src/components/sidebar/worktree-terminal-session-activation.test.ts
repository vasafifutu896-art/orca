import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  focusTerminalTabSurface: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn(() => null as string | null),
  isWebRuntimeSessionActive: vi.fn(() => false),
  activateWebRuntimeSessionTab: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: { getState: mocks.getState }
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: mocks.focusTerminalTabSurface
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))
vi.mock('@/runtime/web-runtime-session', () => ({
  isWebRuntimeSessionActive: mocks.isWebRuntimeSessionActive,
  activateWebRuntimeSessionTab: mocks.activateWebRuntimeSessionTab
}))

import {
  activateWorktreeTerminalSession,
  createWorktreeTerminalSession
} from './worktree-terminal-session-activation'

describe('worktree terminal session activation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  it('activates the project, pane group, and terminal entity together', () => {
    const state = {
      tabsByWorktree: { 'worktree-1': [{ id: 'terminal-1' }] },
      unifiedTabsByWorktree: {
        'worktree-1': [
          {
            id: 'unified-1',
            entityId: 'terminal-1',
            contentType: 'terminal',
            groupId: 'group-1'
          }
        ]
      },
      terminalLayoutsByTabId: { 'terminal-1': { activeLeafId: 'leaf-1' } },
      setActiveWorktree: vi.fn(() => true),
      reconcileWorktreeTabModel: vi.fn(),
      focusGroup: vi.fn(),
      activateTab: vi.fn(),
      setActiveTab: vi.fn(),
      setActiveTabType: vi.fn()
    }
    mocks.getState.mockReturnValue(state)

    expect(activateWorktreeTerminalSession('worktree-1', 'terminal-1')).toBe(true)
    expect(state.setActiveWorktree).toHaveBeenCalledWith('worktree-1')
    expect(state.focusGroup).toHaveBeenCalledWith('worktree-1', 'group-1')
    expect(state.activateTab).toHaveBeenCalledWith('unified-1', { worktreeId: 'worktree-1' })
    expect(state.setActiveTab).toHaveBeenCalledWith('terminal-1')
    expect(state.setActiveTabType).toHaveBeenCalledWith('terminal')
    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('terminal-1', 'leaf-1')
  })

  it('creates a terminal in the project active group', async () => {
    const state = {
      activeGroupIdByWorktree: { 'worktree-1': 'group-1' },
      setActiveWorktree: vi.fn(() => true),
      reconcileWorktreeTabModel: vi.fn(),
      ensureWorktreeRootGroup: vi.fn(() => 'root-group'),
      focusGroup: vi.fn(),
      openNewTerminalTabInActiveWorkspace: vi.fn(async () => undefined)
    }
    mocks.getState.mockReturnValue(state)

    await createWorktreeTerminalSession('worktree-1')

    expect(state.focusGroup).toHaveBeenCalledWith('worktree-1', 'group-1')
    expect(state.openNewTerminalTabInActiveWorkspace).toHaveBeenCalledWith('group-1')
    expect(state.ensureWorktreeRootGroup).not.toHaveBeenCalled()
  })
})
