import { app } from 'electron'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { activateExistingWindow } from '../window/focus-existing-window'
import { getTrustedUIRendererWindow } from './ui'

export type NotificationActivationTarget = {
  worktreeId: string
  paneKey?: string
}
export type NotificationTargetActivationResult = 'activated' | 'navigation-pending' | 'unavailable'

/** Focuses immediately; navigation can remain queued until the renderer installs its listeners. */
export function activateNotificationTarget(
  target: NotificationActivationTarget,
  options: { sendNavigation?: boolean } = {}
): NotificationTargetActivationResult {
  if (!target.worktreeId.includes('::')) {
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
  win.webContents.send('ui:activateWorktree', {
    repoId: getRepoIdFromWorktreeId(target.worktreeId),
    worktreeId: target.worktreeId
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
