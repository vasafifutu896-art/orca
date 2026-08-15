import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { WorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-order'
import { useTerminalPaneCwdSnapshot } from '../../terminal-pane/terminal-pane-cwd-registry'
import { useAppStore } from '@/store'
import { resolveChecksPanelTerminalPtyId } from '../checks-panel-terminal-worktree'
import {
  resolveTerminalManagerPaneKey,
  resolveTerminalManagerWorkingDirectory,
  shouldPollTerminalManagerWorkingDirectory
} from './terminal-manager-session-cwd'
import {
  sessionsForTerminalManagerGroup,
  type TerminalManagerLayout
} from './terminal-manager-layout'
import {
  useTerminalManagerSessionCwds,
  type TerminalManagerCwdTarget
} from './use-terminal-manager-session-cwds'

export function useTerminalManagerWorkingDirectories(args: {
  activeTerminalTabId: string | null
  layout: TerminalManagerLayout
  sessions: readonly WorktreeTerminalSession[]
  worktreePath: string | null
}): ReadonlyMap<string, string | null> {
  const sessionPtyIds = useAppStore(
    useShallow((state) =>
      args.sessions.map((session) =>
        resolveChecksPanelTerminalPtyId({
          activeTabId: session.tab.id,
          ptyIdsByTabId: state.ptyIdsByTabId,
          terminalLayoutsByTabId: state.terminalLayoutsByTabId
        })
      )
    )
  )
  const sessionPaneKeys = useAppStore(
    useShallow((state) =>
      args.sessions.map((session, index) =>
        resolveTerminalManagerPaneKey({
          tabId: session.tab.id,
          ptyId: sessionPtyIds[index] ?? null,
          layout: state.terminalLayoutsByTabId[session.tab.id]
        })
      )
    )
  )
  const paneCwdSnapshot = useTerminalPaneCwdSnapshot()
  const visibleSessionIds = useMemo(() => {
    const visible = new Set<string>()
    for (const group of args.layout.groups) {
      if (!group.collapsed) {
        sessionsForTerminalManagerGroup(args.layout, group.id).forEach((id) => visible.add(id))
      }
    }
    if (!args.layout.ungroupedCollapsed) {
      sessionsForTerminalManagerGroup(args.layout, null).forEach((id) => visible.add(id))
    }
    return visible
  }, [args.layout])
  const cwdTargets = useMemo<TerminalManagerCwdTarget[]>(
    () =>
      args.sessions.flatMap((session, index) => {
        const ptyId = sessionPtyIds[index]
        const paneKey = sessionPaneKeys[index]
        const paneEntry = paneKey ? paneCwdSnapshot[paneKey] : undefined
        if (
          !ptyId ||
          !shouldPollTerminalManagerWorkingDirectory({
            confirmedPaneEntry: paneEntry,
            isVisible: visibleSessionIds.has(session.tab.id),
            ptyId
          })
        ) {
          return []
        }
        return [
          {
            tabId: session.tab.id,
            ptyId,
            priority: session.tab.id === args.activeTerminalTabId
          }
        ]
      }),
    [
      args.activeTerminalTabId,
      args.sessions,
      paneCwdSnapshot,
      sessionPaneKeys,
      sessionPtyIds,
      visibleSessionIds
    ]
  )
  const polledCwdBySessionId = useTerminalManagerSessionCwds(cwdTargets)

  return useMemo(
    () =>
      new Map(
        args.sessions.map((session, index) => {
          const ptyId = sessionPtyIds[index] ?? null
          const paneKey = sessionPaneKeys[index]
          const paneEntry = paneKey ? paneCwdSnapshot[paneKey] : undefined
          const polledEntry = polledCwdBySessionId[session.tab.id]
          const liveEntry =
            paneEntry?.ptyId === ptyId && paneEntry.confirmed
              ? paneEntry
              : polledEntry?.ptyId === ptyId
                ? polledEntry
                : paneEntry
          return [
            session.tab.id,
            resolveTerminalManagerWorkingDirectory({
              liveEntry,
              ptyId,
              startupCwd: session.tab.startupCwd,
              worktreePath: args.worktreePath
            })
          ] as const
        })
      ),
    [
      args.sessions,
      args.worktreePath,
      paneCwdSnapshot,
      polledCwdBySessionId,
      sessionPaneKeys,
      sessionPtyIds
    ]
  )
}
