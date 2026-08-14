export const TERMINAL_MANAGER_LAYOUT_VERSION = 1
export const TERMINAL_MANAGER_GROUP_NAME_MAX_LENGTH = 80

export type TerminalManagerGroup = {
  id: string
  name: string
  collapsed: boolean
}

export type TerminalManagerLayout = {
  version: typeof TERMINAL_MANAGER_LAYOUT_VERSION
  groups: TerminalManagerGroup[]
  sessionGroupById: Record<string, string>
  sessionOrder: string[]
  ungroupedCollapsed: boolean
}

export function createEmptyTerminalManagerLayout(
  sessionIds: readonly string[] = []
): TerminalManagerLayout {
  return {
    version: TERMINAL_MANAGER_LAYOUT_VERSION,
    groups: [],
    sessionGroupById: {},
    sessionOrder: uniqueNonEmptyStrings(sessionIds),
    ungroupedCollapsed: false
  }
}

function uniqueNonEmptyStrings(values: readonly unknown[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) {
      continue
    }
    seen.add(value)
    result.push(value)
  }
  return result
}

function normalizeGroupName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const name = value.trim().slice(0, TERMINAL_MANAGER_GROUP_NAME_MAX_LENGTH)
  return name.length > 0 ? name : null
}

function normalizeGroups(value: unknown): TerminalManagerGroup[] {
  if (!Array.isArray(value)) {
    return []
  }
  const groups: TerminalManagerGroup[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }
    const record = candidate as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const name = normalizeGroupName(record.name)
    if (!id || !name || seen.has(id)) {
      continue
    }
    seen.add(id)
    groups.push({ id, name, collapsed: record.collapsed === true })
  }
  return groups
}

export function normalizeTerminalManagerLayout(
  value: unknown,
  sessionIds: readonly string[]
): TerminalManagerLayout {
  const validSessionIds = uniqueNonEmptyStrings(sessionIds)
  if (!value || typeof value !== 'object') {
    return createEmptyTerminalManagerLayout(validSessionIds)
  }
  const record = value as Record<string, unknown>
  const groups = normalizeGroups(record.groups)
  const validGroupIds = new Set(groups.map((group) => group.id))
  const validSessionIdSet = new Set(validSessionIds)
  const persistedOrder = Array.isArray(record.sessionOrder)
    ? uniqueNonEmptyStrings(record.sessionOrder).filter((id) => validSessionIdSet.has(id))
    : []
  const persistedOrderSet = new Set(persistedOrder)
  const sessionOrder = [
    ...persistedOrder,
    ...validSessionIds.filter((id) => !persistedOrderSet.has(id))
  ]
  const sessionGroupById: Record<string, string> = {}
  if (record.sessionGroupById && typeof record.sessionGroupById === 'object') {
    for (const [sessionId, groupId] of Object.entries(
      record.sessionGroupById as Record<string, unknown>
    )) {
      if (
        validSessionIdSet.has(sessionId) &&
        typeof groupId === 'string' &&
        validGroupIds.has(groupId)
      ) {
        sessionGroupById[sessionId] = groupId
      }
    }
  }
  return {
    version: TERMINAL_MANAGER_LAYOUT_VERSION,
    groups,
    sessionGroupById,
    sessionOrder,
    ungroupedCollapsed: record.ungroupedCollapsed === true
  }
}

export function addTerminalManagerGroup(
  layout: TerminalManagerLayout,
  group: { id: string; name: string }
): TerminalManagerLayout {
  const name = normalizeGroupName(group.name)
  if (!group.id || !name || layout.groups.some((candidate) => candidate.id === group.id)) {
    return layout
  }
  return {
    ...layout,
    groups: [...layout.groups, { id: group.id, name, collapsed: false }]
  }
}

export function renameTerminalManagerGroup(
  layout: TerminalManagerLayout,
  groupId: string,
  nameValue: string
): TerminalManagerLayout {
  const name = normalizeGroupName(nameValue)
  if (!name) {
    return layout
  }
  let changed = false
  const groups = layout.groups.map((group) => {
    if (group.id !== groupId || group.name === name) {
      return group
    }
    changed = true
    return { ...group, name }
  })
  return changed ? { ...layout, groups } : layout
}

export function deleteTerminalManagerGroup(
  layout: TerminalManagerLayout,
  groupId: string
): TerminalManagerLayout {
  if (!layout.groups.some((group) => group.id === groupId)) {
    return layout
  }
  const sessionGroupById = { ...layout.sessionGroupById }
  for (const [sessionId, assignedGroupId] of Object.entries(sessionGroupById)) {
    if (assignedGroupId === groupId) {
      delete sessionGroupById[sessionId]
    }
  }
  return {
    ...layout,
    groups: layout.groups.filter((group) => group.id !== groupId),
    sessionGroupById
  }
}

export function toggleTerminalManagerGroup(
  layout: TerminalManagerLayout,
  groupId: string | null
): TerminalManagerLayout {
  if (groupId === null) {
    return { ...layout, ungroupedCollapsed: !layout.ungroupedCollapsed }
  }
  let changed = false
  const groups = layout.groups.map((group) => {
    if (group.id !== groupId) {
      return group
    }
    changed = true
    return { ...group, collapsed: !group.collapsed }
  })
  return changed ? { ...layout, groups } : layout
}

export function moveTerminalManagerSession(
  layout: TerminalManagerLayout,
  sessionId: string,
  targetGroupId: string | null,
  beforeSessionId?: string | null
): TerminalManagerLayout {
  return moveTerminalManagerSessions(layout, [sessionId], targetGroupId, beforeSessionId)
}

export function moveTerminalManagerSessions(
  layout: TerminalManagerLayout,
  sessionIds: readonly string[],
  targetGroupId: string | null,
  beforeSessionId?: string | null
): TerminalManagerLayout {
  const validSessionIds = new Set(layout.sessionOrder)
  const movingIds = uniqueNonEmptyStrings(sessionIds).filter((id) => validSessionIds.has(id))
  if (movingIds.length === 0) {
    return layout
  }
  if (targetGroupId && !layout.groups.some((group) => group.id === targetGroupId)) {
    return layout
  }
  const movingIdSet = new Set(movingIds)
  if (beforeSessionId && movingIdSet.has(beforeSessionId)) {
    return layout
  }
  const sessionOrder = layout.sessionOrder.filter((id) => !movingIdSet.has(id))
  const beforeIndex = beforeSessionId ? sessionOrder.indexOf(beforeSessionId) : -1
  sessionOrder.splice(beforeIndex >= 0 ? beforeIndex : sessionOrder.length, 0, ...movingIds)
  const sessionGroupById = { ...layout.sessionGroupById }
  for (const sessionId of movingIds) {
    if (targetGroupId) {
      sessionGroupById[sessionId] = targetGroupId
    } else {
      delete sessionGroupById[sessionId]
    }
  }
  return { ...layout, sessionOrder, sessionGroupById }
}

export function moveTerminalManagerGroup(
  layout: TerminalManagerLayout,
  groupId: string,
  beforeGroupId?: string | null
): TerminalManagerLayout {
  const moving = layout.groups.find((group) => group.id === groupId)
  if (!moving || beforeGroupId === groupId) {
    return layout
  }
  const groups = layout.groups.filter((group) => group.id !== groupId)
  const beforeIndex = beforeGroupId ? groups.findIndex((group) => group.id === beforeGroupId) : -1
  groups.splice(beforeIndex >= 0 ? beforeIndex : groups.length, 0, moving)
  return { ...layout, groups }
}

export function sessionsForTerminalManagerGroup(
  layout: TerminalManagerLayout,
  groupId: string | null
): string[] {
  return layout.sessionOrder.filter((sessionId) => {
    const assignedGroupId = layout.sessionGroupById[sessionId] ?? null
    return assignedGroupId === groupId
  })
}
