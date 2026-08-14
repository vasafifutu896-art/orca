import { describe, expect, it } from 'vitest'
import {
  addTerminalManagerGroup,
  createEmptyTerminalManagerLayout,
  deleteTerminalManagerGroup,
  moveTerminalManagerGroup,
  moveTerminalManagerSession,
  normalizeTerminalManagerLayout,
  renameTerminalManagerGroup,
  sessionsForTerminalManagerGroup,
  toggleTerminalManagerGroup
} from './terminal-manager-layout'

describe('terminal manager layout', () => {
  it('sanitizes persisted data and appends newly opened sessions', () => {
    const result = normalizeTerminalManagerLayout(
      {
        version: 1,
        groups: [
          { id: 'build', name: ' Build ', collapsed: true },
          { id: 'build', name: 'Duplicate' },
          { id: 'empty', name: '   ' }
        ],
        sessionOrder: ['session-b', 'closed', 'session-b'],
        sessionGroupById: {
          'session-b': 'build',
          closed: 'build',
          'session-a': 'missing'
        },
        ungroupedCollapsed: true
      },
      ['session-a', 'session-b', 'session-c']
    )

    expect(result).toEqual({
      version: 1,
      groups: [{ id: 'build', name: 'Build', collapsed: true }],
      sessionOrder: ['session-b', 'session-a', 'session-c'],
      sessionGroupById: { 'session-b': 'build' },
      ungroupedCollapsed: true
    })
  })

  it('adds, renames, collapses, reorders, and deletes groups', () => {
    let layout = createEmptyTerminalManagerLayout(['one'])
    layout = addTerminalManagerGroup(layout, { id: 'build', name: ' Build ' })
    layout = addTerminalManagerGroup(layout, { id: 'review', name: 'Review' })
    layout = renameTerminalManagerGroup(layout, 'build', 'Implementation')
    layout = toggleTerminalManagerGroup(layout, 'review')
    layout = moveTerminalManagerGroup(layout, 'review', 'build')

    expect(layout.groups).toEqual([
      { id: 'review', name: 'Review', collapsed: true },
      { id: 'build', name: 'Implementation', collapsed: false }
    ])

    layout = moveTerminalManagerSession(layout, 'one', 'build')
    layout = deleteTerminalManagerGroup(layout, 'build')
    expect(layout.groups.map((group) => group.id)).toEqual(['review'])
    expect(layout.sessionGroupById).toEqual({})
  })

  it('moves sessions between groups and reorders within a group', () => {
    let layout = createEmptyTerminalManagerLayout(['one', 'two', 'three'])
    layout = addTerminalManagerGroup(layout, { id: 'build', name: 'Build' })
    layout = moveTerminalManagerSession(layout, 'one', 'build')
    layout = moveTerminalManagerSession(layout, 'three', 'build', 'one')
    layout = moveTerminalManagerSession(layout, 'two', 'build', 'one')

    expect(sessionsForTerminalManagerGroup(layout, 'build')).toEqual(['three', 'two', 'one'])
    expect(sessionsForTerminalManagerGroup(layout, null)).toEqual([])

    layout = moveTerminalManagerSession(layout, 'two', null)
    expect(sessionsForTerminalManagerGroup(layout, 'build')).toEqual(['three', 'one'])
    expect(sessionsForTerminalManagerGroup(layout, null)).toEqual(['two'])
  })

  it('ignores unknown session and group targets', () => {
    const layout = createEmptyTerminalManagerLayout(['one'])
    expect(moveTerminalManagerSession(layout, 'missing', null)).toBe(layout)
    expect(moveTerminalManagerSession(layout, 'one', 'missing')).toBe(layout)
    expect(deleteTerminalManagerGroup(layout, 'missing')).toBe(layout)
    expect(renameTerminalManagerGroup(layout, 'missing', 'Name')).toBe(layout)
  })
})
