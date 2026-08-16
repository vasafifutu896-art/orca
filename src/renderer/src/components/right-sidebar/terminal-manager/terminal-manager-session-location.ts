import type { PublicKnownRuntimeEnvironment } from '../../../../../shared/runtime-environments'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../../shared/execution-host'
import { parseAppSshPtyId } from '../../../../../shared/ssh-pty-id'
import { parseRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import { formatTerminalManagerWorkingDirectory } from './terminal-manager-session-cwd'

export type TerminalManagerSessionLocation = {
  cwd: string | null
  host: string
}

type HostResolverArgs = {
  executionHostId: ExecutionHostId | null
  ptyId: string | null
  runtimeEnvironments: readonly PublicKnownRuntimeEnvironment[]
  runtimeSshTargets: ReadonlyMap<
    string,
    { targetLabels: ReadonlyMap<string, string>; removedTargetLabels: ReadonlyMap<string, string> }
  >
  sshTargetHosts: ReadonlyMap<string, string>
  sshTargetLabels: ReadonlyMap<string, string>
}

function runtimeEnvironmentHost(
  environmentId: string,
  environments: readonly PublicKnownRuntimeEnvironment[]
): string {
  const environment = environments.find((candidate) => candidate.id === environmentId)
  if (!environment) {
    return environmentId
  }
  const endpoint =
    environment.endpoints.find((candidate) => candidate.id === environment.preferredEndpointId) ??
    environment.endpoints[0]
  if (endpoint) {
    try {
      const hostname = new URL(endpoint.endpoint).hostname.trim()
      if (hostname) {
        return hostname
      }
    } catch {
      // A friendly environment name is safer than exposing an invalid endpoint.
    }
  }
  return environment.name.trim() || environmentId
}

function sshTargetHost(
  targetId: string,
  hosts: ReadonlyMap<string, string>,
  labels: ReadonlyMap<string, string>
): string {
  return hosts.get(targetId)?.trim() || labels.get(targetId)?.trim() || targetId
}

export function resolveTerminalManagerSessionHost(args: HostResolverArgs): string {
  const directSsh = args.ptyId ? parseAppSshPtyId(args.ptyId) : null
  if (directSsh) {
    return sshTargetHost(directSsh.connectionId, args.sshTargetHosts, args.sshTargetLabels)
  }

  const executionHost = parseExecutionHostId(args.executionHostId)
  // A runtime-backed workspace can still execute through a nested SSH target.
  // That target is the machine the terminal is actually working on, while the
  // remote-runtime PTY only identifies the relay that carries its stream.
  if (executionHost?.kind === 'ssh') {
    const remoteRuntime = args.ptyId ? parseRemoteRuntimePtyId(args.ptyId) : null
    if (remoteRuntime?.environmentId) {
      const bucket = args.runtimeSshTargets.get(remoteRuntime.environmentId)
      return (
        bucket?.targetLabels.get(executionHost.targetId)?.trim() ||
        bucket?.removedTargetLabels.get(executionHost.targetId)?.trim() ||
        executionHost.targetId
      )
    }
    return sshTargetHost(executionHost.targetId, args.sshTargetHosts, args.sshTargetLabels)
  }

  const remoteRuntime = args.ptyId ? parseRemoteRuntimePtyId(args.ptyId) : null
  if (remoteRuntime?.environmentId) {
    return runtimeEnvironmentHost(remoteRuntime.environmentId, args.runtimeEnvironments)
  }

  if (executionHost?.kind === 'runtime') {
    return runtimeEnvironmentHost(executionHost.environmentId, args.runtimeEnvironments)
  }
  return 'localhost'
}

export function formatTerminalManagerSessionLocation(
  location: TerminalManagerSessionLocation
): string {
  return `${location.host} · ${formatTerminalManagerWorkingDirectory(location.cwd) ?? '…'}`
}

export function formatFullTerminalManagerSessionLocation(
  location: TerminalManagerSessionLocation
): string {
  return `${location.host} · ${location.cwd?.trim() || '…'}`
}
