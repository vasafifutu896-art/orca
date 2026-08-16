// @vitest-environment happy-dom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toAppSshPtyId } from '../../../../../shared/ssh-pty-id'
import { makePaneKey } from '../../../../../shared/stable-pane-id'
import type { WorktreeTerminalSession } from '../../sidebar/worktree-terminal-session-order'
import type * as TerminalPaneCwdRegistry from '../../terminal-pane/terminal-pane-cwd-registry'
import { createEmptyTerminalManagerLayout } from './terminal-manager-layout'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = makePaneKey('tab-1', LEAF_ID)

const mocks = vi.hoisted(() => ({
  paneCwds: {} as TerminalPaneCwdRegistry.TerminalPaneCwdSnapshot,
  polledCwds: {} as Readonly<
    Record<
      string,
      {
        ptyId: string
        cwd: string
        connectionGeneration?: number
        hostHint?: string | null
        nestedSsh?: boolean
      }
    >
  >,
  poll: vi.fn(),
  state: {
    ptyIdsByTabId: { 'tab-1': ['pty-1'] } as Record<string, string[]>,
    lastKnownRelayPtyIdByTabId: {} as Record<string, string>,
    sshConnectionStates: new Map<string, { connectionGeneration?: number }>(),
    terminalLayoutsByTabId: {
      'tab-1': {
        root: null,
        activeLeafId: '11111111-1111-4111-8111-111111111111',
        expandedLeafId: null,
        ptyIdsByLeafId: { '11111111-1111-4111-8111-111111111111': 'pty-1' }
      }
    }
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

vi.mock('../../terminal-pane/terminal-pane-cwd-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof TerminalPaneCwdRegistry>()
  return {
    ...actual,
    useTerminalPaneCwdSnapshot: () => mocks.paneCwds
  }
})

vi.mock('./use-terminal-manager-session-cwds', () => ({
  useTerminalManagerSessionCwds: (targets: unknown) => {
    mocks.poll(targets)
    return mocks.polledCwds
  }
}))

import { useTerminalManagerWorkingDirectories } from './use-terminal-manager-working-directories'

const sessions: readonly WorktreeTerminalSession[] = [
  {
    unifiedTab: null,
    tab: {
      id: 'tab-1',
      ptyId: 'pty-1',
      worktreeId: 'repo::/repo',
      title: 'Terminal 1',
      customTitle: null,
      color: null,
      sortOrder: 0,
      createdAt: 1
    }
  }
]

describe('useTerminalManagerWorkingDirectories', () => {
  beforeEach(() => {
    mocks.paneCwds = {}
    mocks.polledCwds = {}
    mocks.poll.mockReset()
    mocks.state.ptyIdsByTabId = { 'tab-1': ['pty-1'] }
    mocks.state.lastKnownRelayPtyIdByTabId = {}
    mocks.state.sshConnectionStates = new Map([['ssh-server', { connectionGeneration: 7 }]])
  })

  afterEach(cleanup)

  it('uses a confirmed OSC 7 cwd without polling', () => {
    mocks.paneCwds = {
      [PANE_KEY]: { ptyId: 'pty-1', cwd: '/repo/packages/api', confirmed: true }
    }
    const layout = createEmptyTerminalManagerLayout(['tab-1'])
    const { result } = renderHook(() =>
      useTerminalManagerWorkingDirectories({
        activeTerminalTabId: 'tab-1',
        layout,
        sessions,
        worktreePath: '/repo'
      })
    )

    expect(result.current.get('tab-1')).toEqual({
      cwd: '/repo/packages/api',
      hostHint: null,
      nestedSsh: false
    })
    expect(mocks.poll).toHaveBeenLastCalledWith([])
  })

  it('polls an unconfirmed visible pane but excludes a collapsed group', () => {
    mocks.paneCwds = {
      [PANE_KEY]: { ptyId: 'pty-1', cwd: '/repo/replayed', confirmed: false }
    }
    mocks.polledCwds = { 'tab-1': { ptyId: 'pty-1', cwd: '/repo/live' } }
    const visibleLayout = createEmptyTerminalManagerLayout(['tab-1'])
    const view = renderHook(
      ({ layout }) =>
        useTerminalManagerWorkingDirectories({
          activeTerminalTabId: 'tab-1',
          layout,
          sessions,
          worktreePath: '/repo'
        }),
      { initialProps: { layout: visibleLayout } }
    )

    expect(mocks.poll).toHaveBeenLastCalledWith([
      { tabId: 'tab-1', ptyId: 'pty-1', priority: true }
    ])
    expect(view.result.current.get('tab-1')?.cwd).toBe('/repo/live')

    view.rerender({ layout: { ...visibleLayout, ungroupedCollapsed: true } })
    expect(mocks.poll).toHaveBeenLastCalledWith([])
  })

  it('keeps an unconfirmed parked cwd visible until polling returns', () => {
    mocks.paneCwds = {
      [PANE_KEY]: { ptyId: 'pty-1', cwd: '/repo/packages/api', confirmed: false }
    }
    const layout = createEmptyTerminalManagerLayout(['tab-1'])
    const { result } = renderHook(() =>
      useTerminalManagerWorkingDirectories({
        activeTerminalTabId: 'tab-1',
        layout,
        sessions,
        worktreePath: '/repo'
      })
    )

    expect(result.current.get('tab-1')?.cwd).toBe('/repo/packages/api')
    expect(mocks.poll).toHaveBeenLastCalledWith([
      { tabId: 'tab-1', ptyId: 'pty-1', priority: true }
    ])
  })

  it('uses the retained tab pty when the live pty map has not hydrated yet', () => {
    mocks.state.ptyIdsByTabId = {}
    mocks.polledCwds = { 'tab-1': { ptyId: 'pty-1', cwd: '/srv/noonoo' } }
    const layout = createEmptyTerminalManagerLayout(['tab-1'])
    const { result } = renderHook(() =>
      useTerminalManagerWorkingDirectories({
        activeTerminalTabId: 'tab-1',
        layout,
        sessions,
        worktreePath: null
      })
    )

    expect(mocks.poll).toHaveBeenLastCalledWith([
      { tabId: 'tab-1', ptyId: 'pty-1', priority: true }
    ])
    expect(result.current.get('tab-1')?.cwd).toBe('/srv/noonoo')
  })

  it('refreshes a confirmed direct SSH cwd after the remote shell changes directories', () => {
    const sshPtyId = toAppSshPtyId('ssh-server', 'relay-pty-1')
    const sshSessions = [
      {
        ...sessions[0],
        tab: { ...sessions[0].tab, ptyId: sshPtyId }
      }
    ]
    mocks.state.ptyIdsByTabId = { 'tab-1': [sshPtyId] }
    mocks.state.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: sshPtyId }
      }
    }
    mocks.paneCwds = {
      [PANE_KEY]: { ptyId: sshPtyId, cwd: '/srv/old', confirmed: true }
    }
    mocks.polledCwds = {
      'tab-1': { ptyId: sshPtyId, cwd: '/srv/new', connectionGeneration: 7 }
    }
    const layout = createEmptyTerminalManagerLayout(['tab-1'])
    const { result } = renderHook(() =>
      useTerminalManagerWorkingDirectories({
        activeTerminalTabId: 'tab-1',
        layout,
        sessions: sshSessions,
        worktreePath: '/root'
      })
    )

    expect(result.current.get('tab-1')).toEqual({
      cwd: '/srv/new',
      hostHint: null,
      nestedSsh: false
    })
    expect(mocks.poll).toHaveBeenLastCalledWith([
      { tabId: 'tab-1', ptyId: sshPtyId, connectionGeneration: 7, priority: true }
    ])
  })

  it('uses the nested SSH display location instead of the outer cwd', () => {
    const sshPtyId = toAppSshPtyId('ssh-server', 'relay-pty-1')
    const sshSessions = [{ ...sessions[0], tab: { ...sessions[0].tab, ptyId: sshPtyId } }]
    mocks.state.ptyIdsByTabId = { 'tab-1': [sshPtyId] }
    mocks.state.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: sshPtyId }
      }
    }
    mocks.paneCwds = {
      [PANE_KEY]: { ptyId: sshPtyId, cwd: '/root', confirmed: true }
    }
    mocks.polledCwds = {
      'tab-1': {
        ptyId: sshPtyId,
        cwd: '/home/test',
        connectionGeneration: 7,
        hostHint: 'inner.example',
        nestedSsh: true
      }
    }
    const { result } = renderHook(() =>
      useTerminalManagerWorkingDirectories({
        activeTerminalTabId: 'tab-1',
        layout: createEmptyTerminalManagerLayout(['tab-1']),
        sessions: sshSessions,
        worktreePath: '/root'
      })
    )

    expect(result.current.get('tab-1')).toEqual({
      cwd: '/home/test',
      hostHint: 'inner.example',
      nestedSsh: true
    })
  })

  it('does not substitute an outer or worktree cwd while nested SSH location is unknown', () => {
    const sshPtyId = toAppSshPtyId('ssh-server', 'relay-pty-1')
    const sshSessions = [{ ...sessions[0], tab: { ...sessions[0].tab, ptyId: sshPtyId } }]
    mocks.state.ptyIdsByTabId = { 'tab-1': [sshPtyId] }
    mocks.state.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: sshPtyId }
      }
    }
    mocks.paneCwds = {
      [PANE_KEY]: { ptyId: sshPtyId, cwd: '/root', confirmed: true }
    }
    mocks.polledCwds = {
      'tab-1': {
        ptyId: sshPtyId,
        cwd: '',
        connectionGeneration: 7,
        hostHint: 'inner.example',
        nestedSsh: true
      }
    }
    const { result } = renderHook(() =>
      useTerminalManagerWorkingDirectories({
        activeTerminalTabId: 'tab-1',
        layout: createEmptyTerminalManagerLayout(['tab-1']),
        sessions: sshSessions,
        worktreePath: '/workspace'
      })
    )

    expect(result.current.get('tab-1')).toEqual({
      cwd: null,
      hostHint: 'inner.example',
      nestedSsh: true
    })
  })

  it('does not substitute a startup cwd when the structured outer cwd is unknown', () => {
    const sshPtyId = toAppSshPtyId('ssh-server', 'relay-pty-1')
    const sshSessions = [{ ...sessions[0], tab: { ...sessions[0].tab, ptyId: sshPtyId } }]
    mocks.state.ptyIdsByTabId = { 'tab-1': [sshPtyId] }
    mocks.state.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: sshPtyId }
      }
    }
    mocks.paneCwds = {
      [PANE_KEY]: { ptyId: sshPtyId, cwd: '/root', confirmed: true }
    }
    mocks.polledCwds = {
      'tab-1': {
        ptyId: sshPtyId,
        cwd: '',
        connectionGeneration: 7,
        hostHint: null,
        nestedSsh: false
      }
    }

    const { result } = renderHook(() =>
      useTerminalManagerWorkingDirectories({
        activeTerminalTabId: 'tab-1',
        layout: createEmptyTerminalManagerLayout(['tab-1']),
        sessions: sshSessions,
        worktreePath: '/workspace'
      })
    )

    expect(result.current.get('tab-1')).toEqual({
      cwd: null,
      hostHint: null,
      nestedSsh: false
    })
  })

  it('rejects a polled SSH location after the connection generation changes', () => {
    const sshPtyId = toAppSshPtyId('ssh-server', 'relay-pty-1')
    const sshSessions = [{ ...sessions[0], tab: { ...sessions[0].tab, ptyId: sshPtyId } }]
    mocks.state.ptyIdsByTabId = { 'tab-1': [sshPtyId] }
    mocks.state.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: sshPtyId }
      }
    }
    mocks.polledCwds = {
      'tab-1': {
        ptyId: sshPtyId,
        cwd: '/old-generation',
        connectionGeneration: 7,
        nestedSsh: false
      }
    }
    const layout = createEmptyTerminalManagerLayout(['tab-1'])
    const view = renderHook(() =>
      useTerminalManagerWorkingDirectories({
        activeTerminalTabId: 'tab-1',
        layout,
        sessions: sshSessions,
        worktreePath: '/workspace'
      })
    )
    expect(view.result.current.get('tab-1')?.cwd).toBe('/old-generation')

    mocks.state.sshConnectionStates = new Map([['ssh-server', { connectionGeneration: 8 }]])
    view.rerender()

    expect(mocks.poll).toHaveBeenLastCalledWith([
      { tabId: 'tab-1', ptyId: sshPtyId, connectionGeneration: 8, priority: true }
    ])
    expect(view.result.current.get('tab-1')?.cwd).toBe('/workspace')
  })
})
