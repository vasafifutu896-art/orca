import {
  createEmptyTerminalManagerLayout,
  normalizeTerminalManagerLayout,
  type TerminalManagerLayout
} from './terminal-manager-layout'

const TERMINAL_MANAGER_LAYOUT_STORAGE_PREFIX = 'orca:terminal-manager-layout:v1:'

export type TerminalManagerLayoutStorage = Pick<Storage, 'getItem' | 'setItem'>

export function terminalManagerLayoutStorageKey(worktreeId: string): string {
  return `${TERMINAL_MANAGER_LAYOUT_STORAGE_PREFIX}${encodeURIComponent(worktreeId)}`
}

function getBrowserStorage(): TerminalManagerLayoutStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadTerminalManagerLayout(
  worktreeId: string,
  sessionIds: readonly string[],
  storage: TerminalManagerLayoutStorage | null = getBrowserStorage()
): TerminalManagerLayout {
  if (!storage) {
    return createEmptyTerminalManagerLayout(sessionIds)
  }
  try {
    const raw = storage.getItem(terminalManagerLayoutStorageKey(worktreeId))
    return normalizeTerminalManagerLayout(raw ? JSON.parse(raw) : null, sessionIds)
  } catch {
    return createEmptyTerminalManagerLayout(sessionIds)
  }
}

export function saveTerminalManagerLayout(
  worktreeId: string,
  layout: TerminalManagerLayout,
  storage: TerminalManagerLayoutStorage | null = getBrowserStorage()
): boolean {
  if (!storage) {
    return false
  }
  try {
    storage.setItem(terminalManagerLayoutStorageKey(worktreeId), JSON.stringify(layout))
    return true
  } catch {
    return false
  }
}
