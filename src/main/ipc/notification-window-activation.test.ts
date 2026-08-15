import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getWindow, activateWindow } = vi.hoisted(() => ({
  getWindow: vi.fn(),
  activateWindow: vi.fn()
}))

vi.mock('electron', () => ({ app: { focus: vi.fn() } }))
vi.mock('./ui', () => ({ getTrustedUIRendererWindow: getWindow }))
vi.mock('../window/focus-existing-window', () => ({ activateExistingWindow: activateWindow }))

import { activateNotificationTarget } from './notification-window-activation'

describe('activateNotificationTarget', () => {
  beforeEach(() => {
    getWindow.mockReset()
    activateWindow.mockReset()
  })

  it('waits while the trusted renderer window is unavailable', () => {
    getWindow.mockReturnValue(null)

    expect(activateNotificationTarget({ worktreeId: 'repo::C:\\work\\한국어' })).toBe('unavailable')
    expect(activateWindow).not.toHaveBeenCalled()
  })

  it('activates the exact worktree and terminal leaf in the owning window', () => {
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    getWindow.mockReturnValue(win)
    const paneKey = 'tab-2:11111111-1111-4111-8111-111111111111'

    expect(activateNotificationTarget({ worktreeId: 'repo::C:\\work\\한국어', paneKey })).toBe(
      'activated'
    )

    expect(activateWindow).toHaveBeenCalledWith(win, expect.anything())
    expect(send).toHaveBeenCalledWith('ui:activateWorkspace', {
      workspaceId: 'repo::C:\\work\\한국어'
    })
    expect(send).toHaveBeenCalledWith('ui:focusTerminal', {
      tabId: 'tab-2',
      worktreeId: 'repo::C:\\work\\한국어',
      leafId: '11111111-1111-4111-8111-111111111111',
      ackPaneKeyOnSuccess: paneKey,
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
  })

  it('activates a folder workspace notification and its exact terminal leaf', () => {
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    getWindow.mockReturnValue(win)
    const workspaceId = 'folder:8449c2be-30a2-4d24-a732-b37da8a9b07c'
    const paneKey = 'tab-folder:11111111-1111-4111-8111-111111111111'

    expect(activateNotificationTarget({ worktreeId: workspaceId, paneKey })).toBe('activated')

    expect(activateWindow).toHaveBeenCalledWith(win, expect.anything())
    expect(send).toHaveBeenCalledWith('ui:activateWorkspace', { workspaceId })
    expect(send).toHaveBeenCalledWith('ui:focusTerminal', {
      tabId: 'tab-folder',
      worktreeId: workspaceId,
      leafId: '11111111-1111-4111-8111-111111111111',
      ackPaneKeyOnSuccess: paneKey,
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
  })

  it('focuses immediately but queues navigation while renderer listeners are unavailable', () => {
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    getWindow.mockReturnValue(win)

    expect(
      activateNotificationTarget(
        { worktreeId: 'repo::C:\\work\\한국어', paneKey: 'tab:leaf' },
        { sendNavigation: false }
      )
    ).toBe('navigation-pending')
    expect(activateWindow).toHaveBeenCalledWith(win, expect.anything())
    expect(send).not.toHaveBeenCalled()
  })

  it('still opens the worktree when the pane key is invalid', () => {
    const send = vi.fn()
    getWindow.mockReturnValue({ isDestroyed: () => false, webContents: { send } })

    expect(activateNotificationTarget({ worktreeId: 'repo::C:\\work', paneKey: 'invalid' })).toBe(
      'activated'
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('ui:activateWorkspace', {
      workspaceId: 'repo::C:\\work'
    })
  })

  it('rejects malformed workspace ids instead of focusing an arbitrary window', () => {
    const send = vi.fn()
    getWindow.mockReturnValue({ isDestroyed: () => false, webContents: { send } })

    expect(activateNotificationTarget({ worktreeId: 'not-a-workspace' })).toBe('unavailable')
    expect(activateWindow).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    expect(activateNotificationTarget({ worktreeId: 'folder:' })).toBe('unavailable')
    expect(activateWindow).not.toHaveBeenCalled()
  })
})
