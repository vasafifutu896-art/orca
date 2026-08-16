import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { parseAppSshPtyId } from '../../../../../shared/ssh-pty-id'
import type { WorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-order'
import { useTerminalPaneCwdSnapshot } from '../../terminal-pane/terminal-pane-cwd-registry'
import { useAppStore } from '@/store'
import { resolveChecksPanelTerminalPtyId } from '../checks-panel-terminal-worktree'
import {
  resolveTerminalManagerPaneKey,
  resolveTerminalManagerWorkingDirectory,
  shouldPollTerminalManagerWorkingDirectory,
  type TerminalManagerCwdTarget,
  type TerminalManagerObservedLocation
} from './terminal-manager-session-cwd'
import {
  sessionsForTerminalManagerGroup,
  type TerminalManagerLayout
} from './terminal-manager-layout'
import { useTerminalManagerSessionCwds } from './use-terminal-manager-session-cwds'

export function useTerminalManagerWorkingDirectories(args: {
  activeTerminalTabId: string | null
  layout: TerminalManagerLayout
  sessions: readonly WorktreeTerminalSession[]
  worktreePath: string | null
}): ReadonlyMap<string, TerminalManagerObservedLocation> {
  const sessionPtyIds = useAppStore(
    useShallow((state) =>
      args.sessions.map(
        (session) =>
          resolveChecksPanelTerminalPtyId({
            activeTabId: session.tab.id,
            ptyIdsByTabId: state.ptyIdsByTabId,
            terminalLayoutsByTabId: state.terminalLayoutsByTabId
          }) ??
          session.tab.ptyId ??
          state.lastKnownRelayPtyIdByTabId[session.tab.id] ??
          null
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
  const sessionSshConnectionGenerations = useAppStore(
    useShallow((state) =>
      sessionPtyIds.map((ptyId) => {
        const parsed = ptyId ? parseAppSshPtyId(ptyId) : null
        return parsed
          ? (state.sshConnectionStates.get(parsed.connectionId)?.connectionGeneration ?? 0)
          : null
      })
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
        const directSsh = Boolean(ptyId && parseAppSshPtyId(ptyId))
        if (
          !ptyId ||
          !shouldPollTerminalManagerWorkingDirectory({
            confirmedPaneEntry: directSsh ? undefined : paneEntry,
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
            ...(directSsh
              ? { connectionGeneration: sessionSshConnectionGenerations[index] ?? 0 }
              : {}),
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
      sessionSshConnectionGenerations,
      visibleSessionIds
    ]
  )
  const polledCwdBySessionId = useTerminalManagerSessionCwds(cwdTargets)

  return useMemo(
    () =>
      new Map<string, TerminalManagerObservedLocation>(
        args.sessions.map((session, index) => {
          const ptyId = sessionPtyIds[index] ?? null
          const paneKey = sessionPaneKeys[index]
          const paneEntry = paneKey ? paneCwdSnapshot[paneKey] : undefined
          const polledEntry = polledCwdBySessionId[session.tab.id]
          const directSsh = Boolean(ptyId && parseAppSshPtyId(ptyId))
          const polledEntryMatches = Boolean(
            polledEntry?.ptyId === ptyId &&
            (!directSsh ||
              polledEntry.connectionGeneration === (sessionSshConnectionGenerations[index] ?? 0))
          )
          if (directSsh && polledEntryMatches && typeof polledEntry?.nestedSsh === 'boolean') {
            return [
              session.tab.id,
              {
                cwd: polledEntry.cwd.trim() || null,
                hostHint: polledEntry.hostHint?.trim() || null,
                nestedSsh: polledEntry.nestedSsh
              }
            ] as const
          }
          const liveEntry =
            directSsh && polledEntryMatches
              ? polledEntry
              : paneEntry?.ptyId === ptyId && paneEntry.confirmed
                ? paneEntry
                : polledEntryMatches
                  ? polledEntry
                  : paneEntry
          return [
            session.tab.id,
            {
              cwd: resolveTerminalManagerWorkingDirectory({
                liveEntry,
                ptyId,
                startupCwd: session.tab.startupCwd,
                worktreePath: args.worktreePath
              }),
              hostHint: null,
              nestedSsh: false
            }
          ] as const
        })
      ),
    [
      args.sessions,
      args.worktreePath,
      paneCwdSnapshot,
      polledCwdBySessionId,
      sessionPaneKeys,
      sessionPtyIds,
      sessionSshConnectionGenerations
    ]
  )
}
