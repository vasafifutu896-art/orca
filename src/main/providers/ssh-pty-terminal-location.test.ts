import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonRpcErrorCode } from '../ssh/relay-protocol'
import { SshPtyProvider } from './ssh-pty-provider'
import { parseSshPtyTerminalLocationProbe } from './ssh-pty-terminal-location'

describe('SSH PTY terminal location', () => {
  const scopedPtyId = 'ssh:conn-1@@pty-1'
  let request: ReturnType<typeof vi.fn>
  let provider: SshPtyProvider

  beforeEach(() => {
    request = vi.fn()
    provider = new SshPtyProvider('conn-1', {
      request,
      notify: vi.fn(),
      onNotification: vi.fn(() => () => {}),
      dispose: vi.fn(),
      isDisposed: vi.fn(() => false)
    } as never)
  })

  it('maps the scoped PTY id and returns a valid relay probe', async () => {
    const probe = {
      incarnationId: 'incarnation-1',
      foreground: { kind: 'ssh', epoch: '321:12345', targetHint: 'inner.example' },
      outerCwd: '/root',
      nestedLocation: {
        cwd: '/home/user/project',
        host: 'inner.example',
        source: 'osc7',
        outputSeq: 42
      }
    }
    request.mockResolvedValue(probe)

    await expect(provider.getTerminalLocation(scopedPtyId)).resolves.toEqual({
      status: 'available',
      probe
    })
    expect(request).toHaveBeenCalledWith('pty.getTerminalLocation', { id: 'pty-1' })
  })

  it('preserves a safe home-relative cwd emitted by a shell title', async () => {
    const probe = {
      incarnationId: 'incarnation-1',
      foreground: { kind: 'ssh', epoch: '321:12345', targetHint: 'inner.example' },
      outerCwd: '/root',
      nestedLocation: {
        cwd: '~/project',
        host: 'inner.example',
        source: 'title',
        outputSeq: 43
      }
    }
    request.mockResolvedValue(probe)

    await expect(provider.getTerminalLocation(scopedPtyId)).resolves.toEqual({
      status: 'available',
      probe
    })
  })

  it('caches method-not-found as an unsupported relay capability', async () => {
    request.mockRejectedValue(
      Object.assign(new Error('Method not found'), { code: JsonRpcErrorCode.MethodNotFound })
    )

    await expect(provider.getTerminalLocation(scopedPtyId)).resolves.toEqual({
      status: 'unsupported'
    })
    await expect(provider.getTerminalLocation(scopedPtyId)).resolves.toEqual({
      status: 'unsupported'
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('retries after a transient relay failure', async () => {
    const probe = {
      incarnationId: null,
      foreground: { kind: 'shell', epoch: '99:1', targetHint: null },
      outerCwd: '/home/user',
      nestedLocation: null
    }
    request.mockRejectedValueOnce(new Error('connection interrupted')).mockResolvedValue(probe)

    await expect(provider.getTerminalLocation(scopedPtyId)).resolves.toEqual({
      status: 'unavailable'
    })
    await expect(provider.getTerminalLocation(scopedPtyId)).resolves.toEqual({
      status: 'available',
      probe
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('reports malformed relay payloads as temporarily unavailable', async () => {
    request.mockResolvedValue({ foreground: { kind: 'ssh' } })

    await expect(provider.getTerminalLocation(scopedPtyId)).resolves.toEqual({
      status: 'unavailable'
    })
  })

  it('rejects malformed and malicious relay payloads', () => {
    const maliciousProbes = [
      {
        incarnationId: 'incarnation-1',
        foreground: { kind: 'ssh', epoch: '1:1', targetHint: 'safe.example\u202eexe' },
        outerCwd: '/root',
        nestedLocation: null
      },
      {
        incarnationId: 'incarnation-1',
        foreground: { kind: 'ssh', epoch: '1:1', targetHint: 'safe.example' },
        outerCwd: '/root',
        nestedLocation: {
          cwd: 'relative/project',
          host: 'inner.example',
          source: 'title',
          outputSeq: 2
        }
      },
      {
        incarnationId: 'incarnation-1',
        foreground: { kind: 'ssh', epoch: '1:1', targetHint: 'safe.example' },
        outerCwd: '/root',
        nestedLocation: {
          cwd: '/home/user/project',
          host: 'inner.example\u001b[31m',
          source: 'osc7',
          outputSeq: 3
        }
      },
      {
        incarnationId: null,
        foreground: { kind: 'ssh', epoch: null, targetHint: null },
        outerCwd: '/root',
        nestedLocation: null
      },
      {
        incarnationId: 'incarnation-1',
        foreground: { kind: 'shell', epoch: '1:1', targetHint: null },
        outerCwd: '/root',
        nestedLocation: {
          cwd: '/spoofed',
          host: 'inner.example',
          source: 'osc7',
          outputSeq: 4
        }
      },
      {
        incarnationId: 'incarnation-1',
        foreground: { kind: 'unknown', epoch: null, targetHint: 'inner.example' },
        outerCwd: null,
        nestedLocation: null
      },
      {
        incarnationId: '',
        foreground: { kind: 'shell', epoch: '1:1', targetHint: null },
        outerCwd: '/root',
        nestedLocation: null
      }
    ]

    for (const probe of maliciousProbes) {
      expect(parseSshPtyTerminalLocationProbe(probe)).toBeNull()
    }
  })
})
