import type { SshConnection } from './ssh-connection'
import type { MultiplexerTransport } from './ssh-channel-multiplexer'
import type { RelayPlatform } from './relay-protocol'
import { waitForSentinel } from './ssh-relay-deploy-helpers'
import { isUnconfirmedSshCommandTermination } from './ssh-relay-exec-command'
import { shellEscape } from './ssh-connection-utils'
import { commandWithNodePath } from './ssh-remote-commands'
import { isWindowsRemoteHost, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellLiteral } from './ssh-remote-powershell'

export type SshRelayReconnectHint = {
  serverBuildId?: string
  platform: RelayPlatform
  hostPlatform: RemoteHostPlatform
  remoteHome: string
  remoteRelayDir: string
  nodePath: string
  sockPath: string
  credentialFile: string
}

type ReconnectHintCandidate = Partial<SshRelayReconnectHint> & {
  platform: RelayPlatform
}

type ReconnectHintEntry = {
  connection: SshConnection
  connectionKey: string | null
  hint: SshRelayReconnectHint
}

const reconnectHints = new Map<string, ReconnectHintEntry>()

function connectionKey(conn: SshConnection): string | null {
  if (typeof conn.getTarget !== 'function') {
    return null
  }
  const target = conn.getTarget()
  return JSON.stringify([
    target.host,
    target.port,
    target.username ?? '',
    target.configHost ?? '',
    target.source ?? ''
  ])
}

function completeReconnectHint(candidate: ReconnectHintCandidate): SshRelayReconnectHint | null {
  if (
    !candidate.hostPlatform ||
    !candidate.remoteHome ||
    !candidate.remoteRelayDir ||
    !candidate.nodePath ||
    !candidate.sockPath ||
    !candidate.credentialFile
  ) {
    return null
  }
  return {
    platform: candidate.platform,
    hostPlatform: candidate.hostPlatform,
    remoteHome: candidate.remoteHome,
    remoteRelayDir: candidate.remoteRelayDir,
    nodePath: candidate.nodePath,
    sockPath: candidate.sockPath,
    credentialFile: candidate.credentialFile,
    ...(candidate.serverBuildId ? { serverBuildId: candidate.serverBuildId } : {})
  }
}

export function rememberSshRelayReconnectHint(
  conn: SshConnection,
  targetId: string | undefined,
  candidate: ReconnectHintCandidate
): void {
  if (!targetId) {
    return
  }
  const hint = completeReconnectHint(candidate)
  if (hint) {
    reconnectHints.set(targetId, { connection: conn, connectionKey: connectionKey(conn), hint })
  }
}

function relayConnectCommand(hint: SshRelayReconnectHint): string {
  if (isWindowsRemoteHost(hint.hostPlatform)) {
    return commandWithNodePath(
      hint.hostPlatform,
      hint.nodePath,
      hint.remoteRelayDir,
      `& ${powerShellLiteral(hint.nodePath)} relay.js --connect --sock-path ${powerShellLiteral(hint.sockPath)} --credential-file ${powerShellLiteral(hint.credentialFile)}`
    )
  }
  return `cd ${shellEscape(hint.remoteRelayDir)} && ${shellEscape(hint.nodePath)} relay.js --connect --sock-path ${shellEscape(hint.sockPath)} --credential-file ${shellEscape(hint.credentialFile)}`
}

export async function reconnectRememberedSshRelay(
  conn: SshConnection,
  targetId: string | undefined,
  signal?: AbortSignal
): Promise<(SshRelayReconnectHint & { transport: MultiplexerTransport }) | null> {
  const entry = targetId ? reconnectHints.get(targetId) : undefined
  const currentConnectionKey = connectionKey(conn)
  if (
    !entry ||
    (entry.connection !== conn &&
      (!entry.connectionKey || entry.connectionKey !== currentConnectionKey))
  ) {
    if (targetId && entry) {
      reconnectHints.delete(targetId)
    }
    return null
  }
  const { hint } = entry
  try {
    const channel = await conn.exec(relayConnectCommand(hint), {
      wrapCommand: !isWindowsRemoteHost(hint.hostPlatform),
      signal
    })
    const transport = await waitForSentinel(channel, signal)
    return { ...hint, transport }
  } catch (error) {
    signal?.throwIfAborted()
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    if (targetId && reconnectHints.get(targetId) === entry) {
      reconnectHints.delete(targetId)
    }
    console.warn(
      `[ssh-relay] Remembered endpoint reconnect failed for ${targetId ?? 'unknown target'}; running full bootstrap: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

export async function connectWindowsSshRelayEndpoint(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  opts: {
    remoteDir: string
    nodePath: string
    sockPath: string
    credentialFile: string
  },
  signal?: AbortSignal
): Promise<MultiplexerTransport> {
  const hint: SshRelayReconnectHint = {
    platform: hostPlatform.relayPlatform,
    hostPlatform,
    remoteHome: opts.remoteDir,
    remoteRelayDir: opts.remoteDir,
    nodePath: opts.nodePath,
    sockPath: opts.sockPath,
    credentialFile: opts.credentialFile
  }
  const channel = await conn.exec(relayConnectCommand(hint), { wrapCommand: false, signal })
  return waitForSentinel(channel, signal)
}

export function resetSshRelayReconnectHintsForTests(): void {
  reconnectHints.clear()
}
