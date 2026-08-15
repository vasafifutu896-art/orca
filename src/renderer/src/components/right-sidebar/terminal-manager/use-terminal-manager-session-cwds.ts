import { useEffect, useRef, useState } from 'react'
import { installWindowVisibilityInterval, isWindowVisible } from '@/lib/window-visibility-interval'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import type { TerminalManagerSessionCwdEntry } from './terminal-manager-session-cwd'

const TERMINAL_MANAGER_CWD_POLL_MS = 15_000
const TERMINAL_MANAGER_CWD_MAX_CONCURRENCY = 2

export type TerminalManagerCwdTarget = {
  tabId: string
  ptyId: string
  priority?: boolean
}

type TerminalManagerSessionCwds = Readonly<Record<string, TerminalManagerSessionCwdEntry>>

type SerializedTerminalManagerCwdTarget = readonly [tabId: string, ptyId: string, priority: boolean]

function serializeTargets(targets: readonly TerminalManagerCwdTarget[]): string {
  return JSON.stringify(
    targets.map(
      ({ tabId, ptyId, priority }): SerializedTerminalManagerCwdTarget => [
        tabId,
        ptyId,
        Boolean(priority)
      ]
    )
  )
}

function parseTargets(serializedTargets: string): TerminalManagerCwdTarget[] {
  return (JSON.parse(serializedTargets) as SerializedTerminalManagerCwdTarget[]).map(
    ([tabId, ptyId, priority]) => ({ tabId, ptyId, priority })
  )
}

export function useTerminalManagerSessionCwds(
  targets: readonly TerminalManagerCwdTarget[]
): TerminalManagerSessionCwds {
  const [cwdByTabId, setCwdByTabId] = useState<Record<string, TerminalManagerSessionCwdEntry>>({})
  const mountedRef = useRef(false)
  const currentPtyByTabIdRef = useRef(new Map<string, string>())
  const inFlightTargetsRef = useRef(new Set<string>())
  const drainCurrentInitialQueueRef = useRef<() => void>(() => undefined)
  const serializedTargets = serializeTargets(targets)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      currentPtyByTabIdRef.current.clear()
      drainCurrentInitialQueueRef.current = () => undefined
    }
  }, [])

  useEffect(() => {
    const eligibleTargets = parseTargets(serializedTargets).filter(
      (target) => !isRemoteRuntimePtyId(target.ptyId)
    )
    currentPtyByTabIdRef.current = new Map(
      eligibleTargets.map((target) => [target.tabId, target.ptyId])
    )
    if (eligibleTargets.length === 0) {
      drainCurrentInitialQueueRef.current = () => undefined
      return
    }

    let disposed = false
    let initialDrainActive = true
    let pollCursor = 0
    const targetKey = (target: TerminalManagerCwdTarget): string =>
      `${target.tabId}\0${target.ptyId}`
    const initialQueue = [...eligibleTargets]
      .sort((left, right) => Number(Boolean(right.priority)) - Number(Boolean(left.priority)))
      .filter((target) => !inFlightTargetsRef.current.has(targetKey(target)))

    const startTarget = (target: TerminalManagerCwdTarget): void => {
      const key = targetKey(target)
      if (
        inFlightTargetsRef.current.has(key) ||
        inFlightTargetsRef.current.size >= TERMINAL_MANAGER_CWD_MAX_CONCURRENCY
      ) {
        return
      }
      inFlightTargetsRef.current.add(key)
      void window.api.pty
        .getCwd(target.ptyId)
        .then((value) => {
          const cwd = value.trim()
          if (
            !cwd ||
            !mountedRef.current ||
            currentPtyByTabIdRef.current.get(target.tabId) !== target.ptyId
          ) {
            return
          }
          setCwdByTabId((current) => {
            const prior = current[target.tabId]
            if (prior?.ptyId === target.ptyId && prior.cwd === cwd) {
              return current
            }
            return { ...current, [target.tabId]: { ptyId: target.ptyId, cwd } }
          })
        })
        .catch(() => {
          // Keep the last good CWD through a reconnect or provider error.
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
    return () => {
      disposed = true
      stopInterval()
      if (drainCurrentInitialQueueRef.current === drainInitialQueue) {
        drainCurrentInitialQueueRef.current = () => undefined
      }
    }
  }, [serializedTargets])

  return cwdByTabId
}
