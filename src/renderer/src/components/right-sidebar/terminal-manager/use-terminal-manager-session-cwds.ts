import { useEffect, useRef, useState } from 'react'
import { parseAppSshPtyId } from '../../../../../shared/ssh-pty-id'
import { installWindowVisibilityInterval, isWindowVisible } from '@/lib/window-visibility-interval'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import {
  parseTerminalManagerCwdTargets,
  serializeTerminalManagerCwdTargets,
  terminalManagerCwdEntryMatchesTarget,
  terminalManagerCwdTargetKey,
  type TerminalManagerCwdTarget,
  type TerminalManagerSessionCwdEntry
} from './terminal-manager-session-cwd'

const TERMINAL_MANAGER_CWD_POLL_MS = 15_000
const TERMINAL_MANAGER_ACTIVE_SSH_CWD_POLL_MS = 2_000
const TERMINAL_MANAGER_CWD_MAX_CONCURRENCY = 2

type TerminalManagerSessionCwds = Readonly<Record<string, TerminalManagerSessionCwdEntry>>

export function useTerminalManagerSessionCwds(
  targets: readonly TerminalManagerCwdTarget[]
): TerminalManagerSessionCwds {
  const [cwdByTabId, setCwdByTabId] = useState<Record<string, TerminalManagerSessionCwdEntry>>({})
  const mountedRef = useRef(false)
  const currentTargetKeyByTabIdRef = useRef(new Map<string, string>())
  const latestCwdByTabIdRef = useRef<Record<string, TerminalManagerSessionCwdEntry>>({})
  const unavailableMissesByTargetKeyRef = useRef(new Map<string, number>())
  const inFlightTargetsRef = useRef(new Set<string>())
  const drainCurrentInitialQueueRef = useRef<() => void>(() => undefined)
  const serializedTargets = serializeTerminalManagerCwdTargets(targets)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      currentTargetKeyByTabIdRef.current.clear()
      latestCwdByTabIdRef.current = {}
      unavailableMissesByTargetKeyRef.current.clear()
      drainCurrentInitialQueueRef.current = () => undefined
    }
  }, [])

  useEffect(() => {
    const eligibleTargets = parseTerminalManagerCwdTargets(serializedTargets).filter(
      (target) => !isRemoteRuntimePtyId(target.ptyId)
    )
    currentTargetKeyByTabIdRef.current = new Map(
      eligibleTargets.map((target) => [target.tabId, terminalManagerCwdTargetKey(target)])
    )
    const eligibleTargetKeys = new Set(eligibleTargets.map(terminalManagerCwdTargetKey))
    unavailableMissesByTargetKeyRef.current = new Map(
      [...unavailableMissesByTargetKeyRef.current].filter(([key]) => eligibleTargetKeys.has(key))
    )
    const currentEntries = latestCwdByTabIdRef.current
    const nextEntries = Object.fromEntries(
      Object.entries(currentEntries).filter(([tabId, entry]) => {
        const target = eligibleTargets.find((candidate) => candidate.tabId === tabId)
        return target ? terminalManagerCwdEntryMatchesTarget(entry, target) : false
      })
    )
    if (Object.keys(nextEntries).length !== Object.keys(currentEntries).length) {
      latestCwdByTabIdRef.current = nextEntries
      setCwdByTabId(nextEntries)
    }
    if (eligibleTargets.length === 0) {
      drainCurrentInitialQueueRef.current = () => undefined
      return
    }

    let disposed = false
    let initialDrainActive = true
    let pollCursor = 0
    let fastPollCursor = 0
    const initialQueue = [...eligibleTargets]
      .sort((left, right) => Number(Boolean(right.priority)) - Number(Boolean(left.priority)))
      .filter((target) => !inFlightTargetsRef.current.has(terminalManagerCwdTargetKey(target)))

    const isCurrentTarget = (target: TerminalManagerCwdTarget): boolean =>
      mountedRef.current &&
      currentTargetKeyByTabIdRef.current.get(target.tabId) === terminalManagerCwdTargetKey(target)

    const clearUnavailableDirectSshCwd = (target: TerminalManagerCwdTarget): void => {
      if (!parseAppSshPtyId(target.ptyId) || !isCurrentTarget(target)) {
        return
      }
      const currentEntries = latestCwdByTabIdRef.current
      if (!terminalManagerCwdEntryMatchesTarget(currentEntries[target.tabId], target)) {
        return
      }
      const nextEntries = { ...currentEntries }
      delete nextEntries[target.tabId]
      latestCwdByTabIdRef.current = nextEntries
      setCwdByTabId(nextEntries)
    }

    const updateTarget = (
      target: TerminalManagerCwdTarget,
      entry: Omit<TerminalManagerSessionCwdEntry, 'ptyId' | 'connectionGeneration'>
    ): void => {
      if (!isCurrentTarget(target)) {
        return
      }
      const currentEntries = latestCwdByTabIdRef.current
      const prior = currentEntries[target.tabId]
      if (
        terminalManagerCwdEntryMatchesTarget(prior, target) &&
        prior.cwd === entry.cwd &&
        prior.hostHint === entry.hostHint &&
        prior.nestedSsh === entry.nestedSsh
      ) {
        return
      }
      const nextEntry: TerminalManagerSessionCwdEntry = {
        ptyId: target.ptyId,
        ...(target.connectionGeneration === undefined
          ? {}
          : { connectionGeneration: target.connectionGeneration }),
        ...entry
      }
      const nextEntries = { ...currentEntries, [target.tabId]: nextEntry }
      latestCwdByTabIdRef.current = nextEntries
      setCwdByTabId(nextEntries)
    }

    const readLegacyCwd = async (target: TerminalManagerCwdTarget): Promise<void> => {
      const cwd = (await window.api.pty.getCwd(target.ptyId)).trim()
      if (!cwd) {
        // Why: an unavailable SSH provider is not evidence that its last
        // successful path is still current; let a newer OSC/static value win.
        clearUnavailableDirectSshCwd(target)
        return
      }
      updateTarget(target, { cwd })
    }

    const recordUnavailableTarget = (target: TerminalManagerCwdTarget): void => {
      if (!isCurrentTarget(target)) {
        return
      }
      const key = terminalManagerCwdTargetKey(target)
      const previousMisses = unavailableMissesByTargetKeyRef.current.get(key) ?? 0
      unavailableMissesByTargetKeyRef.current.set(key, previousMisses + 1)
      const currentEntry = latestCwdByTabIdRef.current[target.tabId]
      if (
        previousMisses === 0 &&
        terminalManagerCwdEntryMatchesTarget(currentEntry, target) &&
        currentEntry?.nestedSsh
      ) {
        // One fast-poll grace sample avoids flicker during a brief relay hiccup.
        return
      }
      updateTarget(target, { cwd: '', hostHint: null, nestedSsh: true })
    }

    const readTarget = async (target: TerminalManagerCwdTarget): Promise<void> => {
      if (!parseAppSshPtyId(target.ptyId)) {
        await readLegacyCwd(target)
        return
      }

      const result = await window.api.pty.getTerminalLocation(target.ptyId)
      if (!isCurrentTarget(target)) {
        return
      }
      if (result.status === 'unsupported') {
        unavailableMissesByTargetKeyRef.current.delete(terminalManagerCwdTargetKey(target))
        try {
          await readLegacyCwd(target)
        } catch {
          clearUnavailableDirectSshCwd(target)
        }
        return
      }
      if (result.status === 'unavailable' || result.probe.foreground.kind === 'unknown') {
        recordUnavailableTarget(target)
        return
      }

      unavailableMissesByTargetKeyRef.current.delete(terminalManagerCwdTargetKey(target))
      const probe = result.probe
      if (probe.foreground.kind === 'ssh') {
        const nestedCwd = probe.nestedLocation?.cwd.trim() ?? ''
        const nestedHost =
          probe.nestedLocation?.host.trim() || probe.foreground.targetHint?.trim() || null
        updateTarget(target, {
          cwd: nestedCwd,
          hostHint: nestedHost,
          nestedSsh: true
        })
        return
      }

      updateTarget(target, {
        cwd: probe.outerCwd?.trim() ?? '',
        hostHint: null,
        nestedSsh: false
      })
    }

    const startTarget = (target: TerminalManagerCwdTarget): void => {
      const key = terminalManagerCwdTargetKey(target)
      if (
        inFlightTargetsRef.current.has(key) ||
        inFlightTargetsRef.current.size >= TERMINAL_MANAGER_CWD_MAX_CONCURRENCY
      ) {
        return
      }
      inFlightTargetsRef.current.add(key)
      void readTarget(target)
        .catch(() => {
          if (parseAppSshPtyId(target.ptyId)) {
            recordUnavailableTarget(target)
          } else {
            clearUnavailableDirectSshCwd(target)
          }
        })
        .finally(() => {
          inFlightTargetsRef.current.delete(key)
          if (!disposed && initialDrainActive) {
            drainInitialQueue()
          } else {
            // Why: a target-set change cannot cancel an IPC already in flight.
            // Let its completion release capacity into the current generation's
            // queue instead of starting another pair and exceeding the cap.
            drainCurrentInitialQueueRef.current()
          }
        })
    }

    const drainInitialQueue = (): void => {
      if (!isWindowVisible()) {
        return
      }
      while (
        initialQueue.length > 0 &&
        inFlightTargetsRef.current.size < TERMINAL_MANAGER_CWD_MAX_CONCURRENCY
      ) {
        const target = initialQueue.shift()
        if (target) {
          startTarget(target)
        }
      }
      if (initialQueue.length === 0) {
        initialDrainActive = false
      }
    }
    drainCurrentInitialQueueRef.current = drainInitialQueue

    const refresh = (): void => {
      if (initialDrainActive) {
        drainInitialQueue()
        return
      }

      const priorityTarget = eligibleTargets.find((target) => target.priority)
      if (priorityTarget) {
        startTarget(priorityTarget)
      }
      let inspected = 0
      while (
        inFlightTargetsRef.current.size < TERMINAL_MANAGER_CWD_MAX_CONCURRENCY &&
        inspected < eligibleTargets.length
      ) {
        const target = eligibleTargets[pollCursor % eligibleTargets.length]
        pollCursor = (pollCursor + 1) % eligibleTargets.length
        inspected += 1
        if (target && target !== priorityTarget) {
          startTarget(target)
        }
      }
    }

    const stopInterval = installWindowVisibilityInterval({
      run: refresh,
      intervalMs: TERMINAL_MANAGER_CWD_POLL_MS
    })
    const directSshTargets = eligibleTargets.filter((target) => parseAppSshPtyId(target.ptyId))
    const fastRefresh = (): void => {
      if (initialDrainActive) {
        drainInitialQueue()
        return
      }
      const priorityTarget = directSshTargets.find((target) => target.priority)
      if (priorityTarget) {
        startTarget(priorityTarget)
      }
      const nestedTargets = directSshTargets.filter(
        (target) =>
          target !== priorityTarget &&
          terminalManagerCwdEntryMatchesTarget(latestCwdByTabIdRef.current[target.tabId], target) &&
          latestCwdByTabIdRef.current[target.tabId]?.nestedSsh
      )
      let inspected = 0
      while (
        nestedTargets.length > 0 &&
        inFlightTargetsRef.current.size < TERMINAL_MANAGER_CWD_MAX_CONCURRENCY &&
        inspected < nestedTargets.length
      ) {
        const target = nestedTargets[fastPollCursor % nestedTargets.length]
        fastPollCursor = (fastPollCursor + 1) % nestedTargets.length
        inspected += 1
        if (target) {
          startTarget(target)
        }
      }
    }
    const stopFastSshInterval =
      directSshTargets.length > 0
        ? installWindowVisibilityInterval({
            run: fastRefresh,
            intervalMs: TERMINAL_MANAGER_ACTIVE_SSH_CWD_POLL_MS
          })
        : () => undefined
    return () => {
      disposed = true
      stopInterval()
      stopFastSshInterval()
      if (drainCurrentInitialQueueRef.current === drainInitialQueue) {
        drainCurrentInitialQueueRef.current = () => undefined
      }
    }
  }, [serializedTargets])

  return cwdByTabId
}
