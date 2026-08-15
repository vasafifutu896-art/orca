import { afterEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  claimTerminalPaneCwdOwner,
  clearTerminalPaneCwd,
  clearTerminalTabCwds,
  getTerminalPaneCwdSnapshot,
  markTerminalTabCwdsUnconfirmed,
  publishTerminalPaneCwd,
  resetTerminalPaneCwdRegistryForTests,
  subscribeTerminalPaneCwds
} from './terminal-pane-cwd-registry'

const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

afterEach(resetTerminalPaneCwdRegistryForTests)

describe('terminal pane cwd registry', () => {
  it('publishes immutable snapshots and ignores repeated values', () => {
    const listener = vi.fn()
    subscribeTerminalPaneCwds(listener)
    const paneKey = makePaneKey('tab-1', LEAF_1)

    publishTerminalPaneCwd({ paneKey, ptyId: 'pty-1', cwd: ' /repo ', confirmed: true })
    const first = getTerminalPaneCwdSnapshot()
    publishTerminalPaneCwd({ paneKey, ptyId: 'pty-1', cwd: '/repo', confirmed: true })

    expect(getTerminalPaneCwdSnapshot()).toBe(first)
    expect(first[paneKey]).toEqual({ ptyId: 'pty-1', cwd: '/repo', confirmed: true })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not let replayed output downgrade a confirmed cwd for the same PTY', () => {
    const paneKey = makePaneKey('tab-1', LEAF_1)
    publishTerminalPaneCwd({ paneKey, ptyId: 'pty-1', cwd: '/repo/live', confirmed: true })
    publishTerminalPaneCwd({ paneKey, ptyId: 'pty-1', cwd: '/repo/replay', confirmed: false })

    expect(getTerminalPaneCwdSnapshot()[paneKey]).toEqual({
      ptyId: 'pty-1',
      cwd: '/repo/live',
      confirmed: true
    })
  })

  it('accepts a new PTY binding and clears a pane or an entire tab', () => {
    const pane1 = makePaneKey('tab-1', LEAF_1)
    const pane2 = makePaneKey('tab-1', LEAF_2)
    const otherTabPane = makePaneKey('tab-2', LEAF_1)
    publishTerminalPaneCwd({ paneKey: pane1, ptyId: 'pty-old', cwd: '/old', confirmed: true })
    publishTerminalPaneCwd({ paneKey: pane1, ptyId: 'pty-new', cwd: '/new', confirmed: false })
    publishTerminalPaneCwd({ paneKey: pane2, ptyId: 'pty-2', cwd: '/two', confirmed: true })
    publishTerminalPaneCwd({
      paneKey: otherTabPane,
      ptyId: 'pty-other',
      cwd: '/other',
      confirmed: true
    })

    expect(getTerminalPaneCwdSnapshot()[pane1]?.ptyId).toBe('pty-new')
    clearTerminalPaneCwd(pane2)
    clearTerminalTabCwds('tab-1')

    expect(getTerminalPaneCwdSnapshot()).toEqual({
      [otherTabPane]: { ptyId: 'pty-other', cwd: '/other', confirmed: true }
    })
  })

  it('keeps a parked tab last-known cwd but marks it eligible for refresh', () => {
    const pane = makePaneKey('tab-1', LEAF_1)
    const otherPane = makePaneKey('tab-2', LEAF_2)
    publishTerminalPaneCwd({ paneKey: pane, ptyId: 'pty-1', cwd: '/repo/live', confirmed: true })
    publishTerminalPaneCwd({
      paneKey: otherPane,
      ptyId: 'pty-2',
      cwd: '/other/live',
      confirmed: true
    })

    markTerminalTabCwdsUnconfirmed('tab-1')

    expect(getTerminalPaneCwdSnapshot()[pane]).toEqual({
      ptyId: 'pty-1',
      cwd: '/repo/live',
      confirmed: false
    })
    expect(getTerminalPaneCwdSnapshot()[otherPane]?.confirmed).toBe(true)
  })

  it('does not let a predecessor cleanup downgrade a replacement mount', () => {
    const pane = makePaneKey('tab-1', LEAF_1)
    const predecessor = {}
    const successor = {}
    claimTerminalPaneCwdOwner(pane, predecessor)
    publishTerminalPaneCwd({
      paneKey: pane,
      ptyId: 'pty-1',
      cwd: '/repo/old',
      confirmed: true,
      owner: predecessor
    })
    claimTerminalPaneCwdOwner(pane, successor)
    publishTerminalPaneCwd({
      paneKey: pane,
      ptyId: 'pty-1',
      cwd: '/repo/new',
      confirmed: true,
      owner: successor
    })

    markTerminalTabCwdsUnconfirmed('tab-1', predecessor)
    clearTerminalPaneCwd(pane, predecessor)
    publishTerminalPaneCwd({
      paneKey: pane,
      ptyId: 'pty-1',
      cwd: '/repo/stale',
      confirmed: true,
      owner: predecessor
    })

    expect(getTerminalPaneCwdSnapshot()[pane]).toEqual({
      ptyId: 'pty-1',
      cwd: '/repo/new',
      confirmed: true
    })
  })

  it('bounds retained cwd entries left behind by cold-parked tabs', () => {
    const firstPaneKey = makePaneKey('tab-0', '00000000-0000-4000-8000-000000000000')
    for (let index = 0; index < 513; index += 1) {
      const leafId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
      publishTerminalPaneCwd({
        paneKey: makePaneKey(`tab-${index}`, leafId),
        ptyId: `pty-${index}`,
        cwd: `/repo/${index}`,
        confirmed: true
      })
    }

    expect(Object.keys(getTerminalPaneCwdSnapshot())).toHaveLength(512)
    expect(getTerminalPaneCwdSnapshot()[firstPaneKey]).toBeUndefined()
  })
})
