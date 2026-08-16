import { resolveTerminalStartupCwd } from '../../../../../shared/terminal-startup-cwd'
import { isTerminalLeafId, makePaneKey, type PaneKey } from '../../../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot } from '../../../../../shared/terminal-tab-types'

export type TerminalManagerCwdTarget = {
  tabId: string
  ptyId: string
  connectionGeneration?: number
  priority?: boolean
}

export type TerminalManagerSessionCwdEntry = {
  ptyId: string
  cwd: string
  /** Fences a relay PTY id that was reused by a later SSH connection. */
  connectionGeneration?: number
  /** Display-only hostname reported by a shell inside a nested SSH session. */
  hostHint?: string | null
  /** Prevents an outer-shell/static cwd from being presented as the nested shell cwd. */
  nestedSsh?: boolean
}

export type TerminalManagerObservedLocation = {
  cwd: string | null
  hostHint: string | null
  nestedSsh: boolean
}

type SerializedTerminalManagerCwdTarget = readonly [
  tabId: string,
  ptyId: string,
  priority: boolean,
  connectionGeneration: number | null
]

export function serializeTerminalManagerCwdTargets(
  targets: readonly TerminalManagerCwdTarget[]
): string {
  return JSON.stringify(
    targets.map(
      ({ tabId, ptyId, priority, connectionGeneration }): SerializedTerminalManagerCwdTarget => [
        tabId,
        ptyId,
        Boolean(priority),
        connectionGeneration ?? null
      ]
    )
  )
}

export function parseTerminalManagerCwdTargets(
  serializedTargets: string
): TerminalManagerCwdTarget[] {
  return (JSON.parse(serializedTargets) as SerializedTerminalManagerCwdTarget[]).map(
    ([tabId, ptyId, priority, connectionGeneration]) => ({
      tabId,
      ptyId,
      priority,
      ...(connectionGeneration === null ? {} : { connectionGeneration })
    })
  )
}

export function terminalManagerCwdTargetKey(target: TerminalManagerCwdTarget): string {
  return `${target.tabId}\0${target.ptyId}\0${target.connectionGeneration ?? ''}`
}

export function terminalManagerCwdEntryMatchesTarget(
  entry: TerminalManagerSessionCwdEntry | undefined,
  target: TerminalManagerCwdTarget
): boolean {
  return Boolean(
    entry &&
    entry.ptyId === target.ptyId &&
    (entry.connectionGeneration ?? null) === (target.connectionGeneration ?? null)
  )
}

export function shouldPollTerminalManagerWorkingDirectory(args: {
  confirmedPaneEntry?: (TerminalManagerSessionCwdEntry & { confirmed: boolean }) | undefined
  isVisible: boolean
  ptyId: string | null
}): boolean {
  return Boolean(
    args.ptyId &&
    args.isVisible &&
    !(args.confirmedPaneEntry?.ptyId === args.ptyId && args.confirmedPaneEntry.confirmed === true)
  )
}

export function resolveTerminalManagerPaneKey(args: {
  layout: TerminalLayoutSnapshot | undefined
  ptyId: string | null
  tabId: string
}): PaneKey | null {
  if (!args.ptyId) {
    return null
  }
  const ptyIdsByLeafId = args.layout?.ptyIdsByLeafId ?? {}
  const activeLeafId = args.layout?.activeLeafId
  if (
    activeLeafId &&
    isTerminalLeafId(activeLeafId) &&
    ptyIdsByLeafId[activeLeafId] === args.ptyId
  ) {
    return makePaneKey(args.tabId, activeLeafId)
  }

  const matchingLeafId = Object.entries(ptyIdsByLeafId).find(
    ([leafId, ptyId]) => isTerminalLeafId(leafId) && ptyId === args.ptyId
  )?.[0]
  return matchingLeafId ? makePaneKey(args.tabId, matchingLeafId) : null
}

export function resolveTerminalManagerWorkingDirectory(args: {
  liveEntry?: TerminalManagerSessionCwdEntry
  ptyId: string | null
  startupCwd?: string
  worktreePath: string | null
}): string | null {
  const liveCwd = args.liveEntry?.ptyId === args.ptyId ? args.liveEntry.cwd.trim() : ''
  if (liveCwd) {
    return liveCwd
  }

  const worktreePath = args.worktreePath?.trim() || null
  const startupCwd = args.startupCwd?.trim()
  if (!startupCwd) {
    return worktreePath
  }
  if (!worktreePath) {
    return startupCwd
  }
  return resolveTerminalStartupCwd(worktreePath, startupCwd) ?? worktreePath
}

export function formatTerminalManagerWorkingDirectory(cwd: string | null): string | null {
  const normalized = cwd?.trim().normalize('NFC')
  if (!normalized) {
    return null
  }

  const isWindowsPath = /^[a-z]:[\\/]/i.test(normalized) || normalized.startsWith('\\\\')
  const separator = isWindowsPath && normalized.includes('\\') ? '\\' : '/'
  const parts = normalized.split(isWindowsPath ? /[\\/]+/ : /\/+/).filter(Boolean)
  if (parts.length <= 2) {
    return normalized
  }
  return `…${separator}${parts.slice(-2).join(separator)}`
}
