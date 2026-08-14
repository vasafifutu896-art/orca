import { useEffect, useMemo, useState } from 'react'
import {
  normalizeTerminalManagerLayout,
  type TerminalManagerLayout
} from './terminal-manager-layout'
import {
  loadTerminalManagerLayout,
  saveTerminalManagerLayout
} from './terminal-manager-layout-storage'

function layoutsEqual(left: TerminalManagerLayout, right: TerminalManagerLayout): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function useTerminalManagerLayout(
  worktreeId: string,
  sessionIds: readonly string[]
): [TerminalManagerLayout, React.Dispatch<React.SetStateAction<TerminalManagerLayout>>] {
  const [layout, setLayout] = useState(() => loadTerminalManagerLayout(worktreeId, sessionIds))
  const normalizedLayout = useMemo(
    () => normalizeTerminalManagerLayout(layout, sessionIds),
    [layout, sessionIds]
  )

  useEffect(() => {
    if (!layoutsEqual(layout, normalizedLayout)) {
      setLayout(normalizedLayout)
      return
    }
    saveTerminalManagerLayout(worktreeId, normalizedLayout)
  }, [layout, normalizedLayout, worktreeId])

  return [normalizedLayout, setLayout]
}
