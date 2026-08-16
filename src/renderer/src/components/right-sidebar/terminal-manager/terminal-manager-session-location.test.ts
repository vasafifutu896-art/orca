import { describe, expect, it } from 'vitest'
import { toAppSshPtyId } from '../../../../../shared/ssh-pty-id'
import { toRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import {
  formatTerminalManagerSessionLocation,
  resolveTerminalManagerSessionHost
} from './terminal-manager-session-location'

const runtimeEnvironment = {
  id: 'runtime-1',
  name: 'Build server',
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: null,
  runtimeId: 'runtime-id',
  endpoints: [
    {
      id: 'preferred',
      kind: 'websocket' as const,
      label: 'WebSocket',
      endpoint: 'wss://198.51.100.20:8787'
    }
  ],
  preferredEndpointId: 'preferred'
}

const metadata = {
  runtimeEnvironments: [runtimeEnvironment],
  runtimeSshTargets: new Map([
    [
      'runtime-1',
      {
        targetLabels: new Map([['nested-ssh', 'Nested database']]),
        removedTargetLabels: new Map<string, string>()
      }
    ]
  ]),
  sshTargetHosts: new Map([['ssh-server', '203.0.113.42']]),
  sshTargetLabels: new Map([
    ['ssh-server', 'Production'],
    ['ssh-fallback', 'Fallback server']
  ])
}

describe('terminal manager session location', () => {
  it('uses the exact SSH PTY server ahead of the workspace host', () => {
    expect(
      resolveTerminalManagerSessionHost({
        ...metadata,
        executionHostId: 'runtime:runtime-1',
        ptyId: toAppSshPtyId('ssh-server', 'relay-pty')
      })
    ).toBe('203.0.113.42')
  })

  it('uses a nested SSH workspace label ahead of its runtime relay PTY', () => {
    expect(
      resolveTerminalManagerSessionHost({
        ...metadata,
        executionHostId: 'ssh:nested-ssh',
        ptyId: toRemoteRuntimePtyId('handle-1', 'runtime-1')
      })
    ).toBe('Nested database')
  })

  it('falls back to an SSH label when the configured host is unavailable', () => {
    expect(
      resolveTerminalManagerSessionHost({
        ...metadata,
        executionHostId: 'ssh:ssh-fallback',
        ptyId: null
      })
    ).toBe('Fallback server')
  })

  it('uses the runtime endpoint hostname and local fallback', () => {
    expect(
      resolveTerminalManagerSessionHost({
        ...metadata,
        executionHostId: 'local',
        ptyId: toRemoteRuntimePtyId('handle-1', 'runtime-1')
      })
    ).toBe('198.51.100.20')
    expect(
      resolveTerminalManagerSessionHost({
        ...metadata,
        executionHostId: 'local',
        ptyId: null
      })
    ).toBe('localhost')
  })

  it('always formats a second line while cwd resolution is pending', () => {
    expect(formatTerminalManagerSessionLocation({ host: '203.0.113.42', cwd: null })).toBe(
      '203.0.113.42 · …'
    )
    expect(
      formatTerminalManagerSessionLocation({ host: '203.0.113.42', cwd: '/srv/apps/noonoo' })
    ).toBe('203.0.113.42 · …/apps/noonoo')
  })
})
