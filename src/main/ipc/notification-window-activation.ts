import { app } from 'electron'
import { splitWorktreeId } from '../../shared/worktree/id'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { activateExistingWindow } from '../window/focus-existing-window'
import { getTrustedUIRendererWindow } from './ui'

export type NotificationActivationTarget = {
  worktreeId: string
  paneKey?: string
}
export type NotificationTargetActivationResult = 'activated' | 'navigation-pending' | 'unavailable'

export function isNotificationWorkspaceId(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const workspaceScope = parseWorkspaceKey(value)
  if (workspaceScope) {
    return workspaceScope.type === 'folder'
  }
  const worktree = splitWorktreeId(value)
  return Boolean(worktree?.repoId && worktree.worktreePath)
}

/** Focuses immediately; navigation can remain queued until the renderer installs its listeners. */
export function activateNotificationTarget(
  target: NotificationActivationTarget,
  options: { sendNavigation?: boolean } = {}
): NotificationTargetActivationResult {
  if (!isNotificationWorkspaceId(target.worktreeId)) {
    return 'unavailable'
  }
  const win = getTrustedUIRendererWindow()
  if (!win || win.isDestroyed()) {
    return 'unavailable'
  }

  activateExistingWindow(win, app)
  if (options.sendNavigation === false) {
    return 'navigation-pending'
  }
  win.webContents.send('ui:activateWorkspace', {
    workspaceId: target.worktreeId
  })

  // Why: the stable leaf ID makes a completion toast land on the exact split pane.
  const paneTarget = target.paneKey ? parsePaneKey(target.paneKey) : null
  if (paneTarget) {
    win.webContents.send('ui:focusTerminal', {
      tabId: paneTarget.tabId,
      worktreeId: target.worktreeId,
      leafId: paneTarget.leafId,
      ackPaneKeyOnSuccess: target.paneKey,
      flashFocusedPane: true,
      scrollToBottomIfOutputSinceLastView: true
    })
  }
  return 'activated'
}
