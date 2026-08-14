import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  activateWebRuntimeSessionTab,
  isWebRuntimeSessionActive
} from '@/runtime/web-runtime-session'
import { useAppStore } from '@/store'

export function activateWorktreeTerminalSession(
  worktreeId: string,
  terminalTabId: string
): boolean {
  const initial = useAppStore.getState()
  if (!(initial.tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === terminalTabId)) {
    return false
  }
  if (!initial.setActiveWorktree(worktreeId)) {
    return false
  }

  initial.reconcileWorktreeTabModel(worktreeId)
  const state = useAppStore.getState()
  const unifiedTab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (tab) => tab.contentType === 'terminal' && tab.entityId === terminalTabId
  )
  if (unifiedTab) {
    state.focusGroup(worktreeId, unifiedTab.groupId)
    state.activateTab(unifiedTab.id, { worktreeId })
  }
  state.setActiveTab(terminalTabId)
  state.setActiveTabType('terminal')

  const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  if (isWebRuntimeSessionActive(runtimeEnvironmentId)) {
    void activateWebRuntimeSessionTab({
      worktreeId,
      tabId: terminalTabId,
      environmentId: runtimeEnvironmentId
    })
  }

  const activeLeafId = state.terminalLayoutsByTabId[terminalTabId]?.activeLeafId ?? null
  requestAnimationFrame(() => focusTerminalTabSurface(terminalTabId, activeLeafId))
  return true
}

export async function createWorktreeTerminalSession(worktreeId: string): Promise<void> {
  const initial = useAppStore.getState()
  if (!initial.setActiveWorktree(worktreeId)) {
    return
  }
  initial.reconcileWorktreeTabModel(worktreeId)
  const state = useAppStore.getState()
  const groupId =
    state.activeGroupIdByWorktree[worktreeId] ?? state.ensureWorktreeRootGroup(worktreeId)
  state.focusGroup(worktreeId, groupId)
  await state.openNewTerminalTabInActiveWorkspace(groupId)
}
