import { useSyncExternalStore } from 'react'
import type { PaneKey } from '../../../../shared/stable-pane-id'

export type TerminalPaneCwdEntry = {
  confirmed: boolean
  cwd: string
  ptyId: string
}

export type TerminalPaneCwdSnapshot = Readonly<Record<string, TerminalPaneCwdEntry>>

const listeners = new Set<() => void>()
const MAX_RETAINED_PANE_CWDS = 512
let snapshot: TerminalPaneCwdSnapshot = {}
const ownerByPaneKey = new Map<string, object>()

function emitChange(): void {
  for (const listener of Array.from(listeners)) {
    listener()
  }
}

export function publishTerminalPaneCwd(args: {
  confirmed: boolean
  cwd: string
  owner?: object
  paneKey: PaneKey
  ptyId: string | null
}): void {
  const cwd = args.cwd.trim()
  if (!cwd || !args.ptyId) {
    return
  }
  if (args.owner && ownerByPaneKey.get(args.paneKey) !== args.owner) {
    return
  }

  const previous = snapshot[args.paneKey]
  if (
    previous?.ptyId === args.ptyId &&
    previous.cwd === cwd &&
    (previous.confirmed || !args.confirmed)
  ) {
    return
  }
  // Why: replayed scrollback can arrive after live output during recovery. It
  // must not downgrade an authoritative live cwd for the same PTY.
  if (previous?.ptyId === args.ptyId && previous.confirmed && !args.confirmed) {
    return
  }

  const next = { ...snapshot }
  delete next[args.paneKey]
  next[args.paneKey] = { confirmed: args.confirmed, cwd, ptyId: args.ptyId }
  while (Object.keys(next).length > MAX_RETAINED_PANE_CWDS) {
    const oldestPaneKey = Object.keys(next)[0]
    if (!oldestPaneKey) {
      break
    }
    delete next[oldestPaneKey]
    ownerByPaneKey.delete(oldestPaneKey)
  }
  snapshot = next
  emitChange()
}

export function claimTerminalPaneCwdOwner(paneKey: PaneKey, owner: object): void {
  if (ownerByPaneKey.get(paneKey) === owner) {
    return
  }
  ownerByPaneKey.set(paneKey, owner)
  const previous = snapshot[paneKey]
  if (!previous?.confirmed) {
    return
  }
  snapshot = { ...snapshot, [paneKey]: { ...previous, confirmed: false } }
  emitChange()
}

export function clearTerminalPaneCwd(paneKey: PaneKey, owner?: object): void {
  if (owner && ownerByPaneKey.get(paneKey) !== owner) {
    return
  }
  if (!snapshot[paneKey]) {
    ownerByPaneKey.delete(paneKey)
    return
  }
  const next = { ...snapshot }
  delete next[paneKey]
  ownerByPaneKey.delete(paneKey)
  snapshot = next
  emitChange()
}

export function clearTerminalTabCwds(tabId: string): void {
  const prefix = `${tabId}:`
  const entries = Object.entries(snapshot).filter(([paneKey]) => !paneKey.startsWith(prefix))
  for (const paneKey of ownerByPaneKey.keys()) {
    if (paneKey.startsWith(prefix)) {
      ownerByPaneKey.delete(paneKey)
    }
  }
  if (entries.length === Object.keys(snapshot).length) {
    return
  }
  snapshot = Object.fromEntries(entries)
  emitChange()
}

export function markTerminalTabCwdsUnconfirmed(tabId: string, owner?: object): void {
  const prefix = `${tabId}:`
  let changed = false
  const entries = Object.entries(snapshot).map(([paneKey, entry]) => {
    if (
      !paneKey.startsWith(prefix) ||
      !entry.confirmed ||
      (owner && ownerByPaneKey.get(paneKey) !== owner)
    ) {
      return [paneKey, entry] as const
    }
    changed = true
    return [paneKey, { ...entry, confirmed: false }] as const
  })
  if (!changed) {
    return
  }
  // Why: a cold-parked pane no longer observes OSC 7. Keep its last-known cwd
  // for display, but let local/SSH polling refresh it while the xterm is absent.
  snapshot = Object.fromEntries(entries)
  emitChange()
}

export function subscribeTerminalPaneCwds(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTerminalPaneCwdSnapshot(): TerminalPaneCwdSnapshot {
  return snapshot
}

export function useTerminalPaneCwdSnapshot(): TerminalPaneCwdSnapshot {
  return useSyncExternalStore(
    subscribeTerminalPaneCwds,
    getTerminalPaneCwdSnapshot,
    getTerminalPaneCwdSnapshot
  )
}

export function resetTerminalPaneCwdRegistryForTests(): void {
  snapshot = {}
  ownerByPaneKey.clear()
  listeners.clear()
}
