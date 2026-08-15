import { describe, expect, it } from 'vitest'
import {
  formatTerminalManagerWorkingDirectory,
  resolveTerminalManagerPaneKey,
  resolveTerminalManagerWorkingDirectory,
  shouldPollTerminalManagerWorkingDirectory
} from './terminal-manager-session-cwd'

const ACTIVE_LEAF = '11111111-1111-4111-8111-111111111111'
const FALLBACK_LEAF = '22222222-2222-4222-8222-222222222222'

describe('terminal manager session cwd', () => {
  it.each([
    ['/Users/ada/repo/packages/web/', '…/packages/web'],
    ['C:\\Users\\Ada\\repo\\apps\\api', '…\\apps\\api'],
    ['\\\\server\\share\\repo\\src', '…\\repo\\src'],
    ['/srv/team\\repo/build', '…/team\\repo/build'],
    ['/repo/app', '/repo/app'],
    ['/', '/'],
    ['', null]
  ])('formats %s as a compact cross-platform path', (cwd, expected) => {
    expect(formatTerminalManagerWorkingDirectory(cwd)).toBe(expected)
  })

  it('resolves the active stable pane key for the selected PTY', () => {
    const layout = {
      root: null,
      activeLeafId: ACTIVE_LEAF,
      expandedLeafId: null,
      ptyIdsByLeafId: {
        [ACTIVE_LEAF]: 'pty-active',
        [FALLBACK_LEAF]: 'pty-fallback'
      }
    }

    expect(resolveTerminalManagerPaneKey({ tabId: 'tab-1', ptyId: 'pty-active', layout })).toBe(
      `tab-1:${ACTIVE_LEAF}`
    )
    expect(resolveTerminalManagerPaneKey({ tabId: 'tab-1', ptyId: 'pty-fallback', layout })).toBe(
      `tab-1:${FALLBACK_LEAF}`
    )
    expect(resolveTerminalManagerPaneKey({ tabId: 'tab-1', ptyId: 'missing', layout })).toBeNull()
  })

  it('polls only visible sessions without a confirmed cwd for the current PTY', () => {
    expect(
      shouldPollTerminalManagerWorkingDirectory({
        ptyId: 'pty-1',
        isVisible: true,
        confirmedPaneEntry: { ptyId: 'pty-1', cwd: '/repo', confirmed: true }
      })
    ).toBe(false)
    expect(
      shouldPollTerminalManagerWorkingDirectory({
        ptyId: 'pty-1',
        isVisible: true,
        confirmedPaneEntry: { ptyId: 'pty-1', cwd: '/repo', confirmed: false }
      })
    ).toBe(true)
    expect(shouldPollTerminalManagerWorkingDirectory({ ptyId: 'pty-1', isVisible: false })).toBe(
      false
    )
  })

  it('prefers a live cwd from the currently bound PTY', () => {
    expect(
      resolveTerminalManagerWorkingDirectory({
        liveEntry: { ptyId: 'pty-current', cwd: '/repo/packages/api' },
        ptyId: 'pty-current',
        startupCwd: '/repo/packages/web',
        worktreePath: '/repo'
      })
    ).toBe('/repo/packages/api')
  })

  it('rejects a stale PTY result and resolves the startup cwd against the workspace', () => {
    expect(
      resolveTerminalManagerWorkingDirectory({
        liveEntry: { ptyId: 'pty-old', cwd: '/old/location' },
        ptyId: 'pty-current',
        startupCwd: 'packages/web',
        worktreePath: '/repo'
      })
    ).toBe('/repo/packages/web')
  })

  it('falls back to the workspace root when no live or startup cwd exists', () => {
    expect(
      resolveTerminalManagerWorkingDirectory({
        ptyId: null,
        worktreePath: 'C:\\work\\orca'
      })
    ).toBe('C:\\work\\orca')
  })
})
