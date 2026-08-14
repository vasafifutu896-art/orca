import type { Tab, TabGroup } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

export type WorktreeTerminalSession = {
  tab: TerminalTab
  unifiedTab: Tab | null
}

export function orderWorktreeTerminalSessions(
  terminalTabs: readonly TerminalTab[],
  unifiedTabs: readonly Tab[],
  groups: readonly TabGroup[]
): WorktreeTerminalSession[] {
  const terminalById = new Map(terminalTabs.map((tab) => [tab.id, tab]))
  const unifiedById = new Map(unifiedTabs.map((tab) => [tab.id, tab]))
  const unifiedByTerminalId = new Map(
    unifiedTabs.filter((tab) => tab.contentType === 'terminal').map((tab) => [tab.entityId, tab])
  )
  const ordered: WorktreeTerminalSession[] = []
  const seen = new Set<string>()

  for (const group of groups) {
    for (const unifiedTabId of group.tabOrder) {
      const unifiedTab = unifiedById.get(unifiedTabId)
      if (!unifiedTab || unifiedTab.contentType !== 'terminal' || seen.has(unifiedTab.entityId)) {
        continue
      }
      const terminalTab = terminalById.get(unifiedTab.entityId)
      if (!terminalTab) {
        continue
      }
      seen.add(terminalTab.id)
      ordered.push({ tab: terminalTab, unifiedTab })
    }
  }

  const remaining = terminalTabs
    .filter((tab) => !seen.has(tab.id))
    .toSorted((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt)
  for (const tab of remaining) {
    ordered.push({ tab, unifiedTab: unifiedByTerminalId.get(tab.id) ?? null })
  }

  return ordered
}
