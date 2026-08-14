import { useEffect } from 'react'

export function useNotificationActivationReady(
  ipcEventListenersReady: boolean,
  workspaceSessionReady: boolean
): void {
  useEffect(() => {
    if (!ipcEventListenersReady || !workspaceSessionReady) {
      return
    }
    // Why: session hydration and terminal reconnect can overwrite active worktree/tab state;
    // flush notification navigation only after their ready flag has painted once.
    const frameId = window.requestAnimationFrame(() => {
      void Promise.resolve(window.api.ui.signalNotificationActivationReady?.()).catch(() => {})
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [ipcEventListenersReady, workspaceSessionReady])
}
