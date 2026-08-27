import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock/app' }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('0.1.0+abcdef012345')
}))

vi.mock('./relay-protocol', () => ({
  RELAY_VERSION: '0.1.0',
  RELAY_REMOTE_DIR: '.orca-remote',
  parseUnameToRelayPlatform: vi.fn(() => 'linux-x64'),
  RELAY_SENTINEL: 'ORCA-RELAY v0.1.0 READY\n',
  RELAY_SENTINEL_TIMEOUT_MS: 10_000
}))

vi.mock('./ssh-relay-deploy-helpers', () => ({
  uploadDirectory: vi.fn().mockResolvedValue(undefined),
  waitForSentinel: vi.fn().mockResolvedValue({
    write: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn()
  }),
  isUnconfirmedSshCommandTermination: (error: unknown) =>
    error instanceof Error &&
    (error as Error & { sshChannelCloseConfirmed?: boolean }).sshChannelCloseConfirmed === false,
  execCommand: vi.fn().mockResolvedValue('__ORCA_REMOTE_PLATFORM__ Linux x86_64')
}))

vi.mock('./ssh-remote-node-resolution', () => ({
  resolveRemoteNodePath: vi.fn().mockResolvedValue('/usr/bin/node')
}))

vi.mock('./ssh-relay-endpoint-credential', () => ({
  writeRelayEndpointCredential: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./ssh-relay-versioned-install', () => ({
  readLocalFullVersion: vi.fn().mockReturnValue('0.1.0+abcdef012345'),
  computeRemoteRelayDir: (home: string, version: string) => `${home}/.orca-remote/relay-${version}`,
  isRelayAlreadyInstalled: vi.fn().mockResolvedValue(true),
  finalizeInstall: vi.fn().mockResolvedValue(undefined),
  abandonInstall: vi.fn().mockResolvedValue(undefined),
  gcOldRelayVersions: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./ssh-relay-install-lock', () => ({
  acquireInstallLock: vi.fn().mockResolvedValue(undefined),
  RELAY_INSTALL_LOCK_NAME: '.install-lock'
}))

vi.mock('./ssh-relay-repair-lock', () => ({
  tryAcquireRelayRepairLock: vi.fn().mockResolvedValue('acquired')
}))

vi.mock('./ssh-connection-utils', () => ({
  shellEscape: (value: string) => `'${value}'`,
  createSshOperationAbortError: () =>
    Object.assign(new Error('SSH operation was cancelled'), { name: 'AbortError' })
}))

import { deployAndLaunchRelay } from './ssh-relay-deploy'
import { execCommand, waitForSentinel } from './ssh-relay-deploy-helpers'
import { resetSshRelayReconnectHintsForTests } from './ssh-relay-reconnect-endpoint'
import { resolveRemoteNodePath } from './ssh-remote-node-resolution'
import type { SshConnection } from './ssh-connection'

function makeMockConnection(host = 'example.com'): SshConnection {
  return {
    canRunConcurrentExecCommands: vi.fn().mockReturnValue(true),
    getTarget: vi.fn().mockReturnValue({
      id: 'target-1',
      label: 'test',
      host,
      port: 22,
      username: 'test'
    }),
    exec: vi.fn().mockResolvedValue({
      on: vi.fn(),
      stderr: { on: vi.fn() },
      stdin: {},
      stdout: { on: vi.fn() },
      close: vi.fn()
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    sftp: vi.fn().mockResolvedValue({
      mkdir: vi.fn((_path: string, callback: (error: Error | null) => void) => callback(null)),
      createWriteStream: vi.fn().mockReturnValue({
        on: vi.fn((event: string, callback: () => void) => {
          if (event === 'close') {
            setTimeout(callback, 0)
          }
        }),
        end: vi.fn()
      }),
      end: vi.fn()
    })
  } as unknown as SshConnection
}

function mockHealthyInstalledPosixRelay() {
  const mockExecCommand = vi.mocked(execCommand)
  mockExecCommand.mockImplementation((_connection, command) => {
    if (command.includes('__ORCA_REMOTE_PLATFORM__')) {
      return Promise.resolve('__ORCA_REMOTE_PLATFORM__ Linux x86_64')
    }
    if (command === 'echo $HOME') {
      return Promise.resolve('/home/user')
    }
    if (command.includes('ORCA-NATIVE-DEPS-OK')) {
      return Promise.resolve('ORCA-NATIVE-DEPS-OK')
    }
    if (command.includes('test -S')) {
      return Promise.resolve('ALIVE')
    }
    return Promise.resolve('')
  })
  return mockExecCommand
}

describe('deployAndLaunchRelay reconnect recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSshRelayReconnectHintsForTests()
    vi.mocked(waitForSentinel).mockReset().mockResolvedValue({
      write: vi.fn(),
      onData: vi.fn(),
      onClose: vi.fn()
    })
    vi.mocked(resolveRemoteNodePath).mockReset().mockResolvedValue('/usr/bin/node')
  })

  it('reattaches to a remembered endpoint without repeating bootstrap probes', async () => {
    const firstConnection = makeMockConnection()
    const mockExecCommand = mockHealthyInstalledPosixRelay()

    await deployAndLaunchRelay(firstConnection, undefined, 300, 'remembered-target')
    const replacementConnection = makeMockConnection()
    await deployAndLaunchRelay(replacementConnection, undefined, 300, 'remembered-target')

    expect(
      mockExecCommand.mock.calls.filter(([, command]) =>
        command.includes('__ORCA_REMOTE_PLATFORM__')
      )
    ).toHaveLength(1)
    expect(resolveRemoteNodePath).toHaveBeenCalledOnce()
    expect(vi.mocked(replacementConnection.exec)).toHaveBeenCalledOnce()
  })

  it('does not reuse a remembered endpoint after the SSH identity changes', async () => {
    const mockExecCommand = mockHealthyInstalledPosixRelay()
    await deployAndLaunchRelay(makeMockConnection(), undefined, 300, 'retargeted-target')
    vi.clearAllMocks()

    const replacementConnection = makeMockConnection('replacement.example.com')
    await deployAndLaunchRelay(replacementConnection, undefined, 300, 'retargeted-target')

    expect(
      mockExecCommand.mock.calls.filter(([, command]) =>
        command.includes('__ORCA_REMOTE_PLATFORM__')
      )
    ).toHaveLength(1)
    expect(resolveRemoteNodePath).toHaveBeenCalledOnce()
    expect(vi.mocked(replacementConnection.exec)).toHaveBeenCalledOnce()
  })

  it('falls back to full bootstrap when the remembered endpoint is stale', async () => {
    const connection = makeMockConnection()
    const mockExecCommand = mockHealthyInstalledPosixRelay()
    await deployAndLaunchRelay(connection, undefined, 300, 'stale-target')
    vi.clearAllMocks()
    vi.mocked(waitForSentinel)
      .mockRejectedValueOnce(new Error('remembered relay is gone'))
      .mockResolvedValue({ write: vi.fn(), onData: vi.fn(), onClose: vi.fn() })

    await deployAndLaunchRelay(connection, undefined, 300, 'stale-target')

    expect(resolveRemoteNodePath).toHaveBeenCalledOnce()
    expect(
      mockExecCommand.mock.calls.filter(([, command]) =>
        command.includes('__ORCA_REMOTE_PLATFORM__')
      )
    ).toHaveLength(1)
    expect(vi.mocked(connection.exec)).toHaveBeenCalledTimes(2)
  })

  it('propagates caller cancellation into an active bootstrap', async () => {
    let bootstrapSignal: AbortSignal | undefined
    vi.mocked(execCommand).mockImplementationOnce((_connection, _command, options) => {
      bootstrapSignal = options?.signal
      return new Promise<string>((_resolve, reject) => {
        bootstrapSignal?.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
          { once: true }
        )
      })
    })
    const controller = new AbortController()
    const deployment = deployAndLaunchRelay(
      makeMockConnection(),
      undefined,
      undefined,
      undefined,
      controller.signal
    ).catch((error: Error) => error)
    await vi.waitFor(() => expect(bootstrapSignal).toBeInstanceOf(AbortSignal))

    controller.abort()

    await expect(deployment).resolves.toMatchObject({ name: 'AbortError' })
    expect(bootstrapSignal?.aborted).toBe(true)
  })
})
