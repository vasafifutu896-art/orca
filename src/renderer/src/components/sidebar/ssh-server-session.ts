import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import { toSshExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { AppState } from '@/store/types'
import type { ActivateAndRevealResult } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'

type SshServerSessionState = Pick<
  AppState,
  | 'projectGroups'
  | 'folderWorkspaces'
  | 'tabsByWorktree'
  | 'sshConnectionStates'
  | 'createProjectGroup'
  | 'createFolderWorkspace'
  | 'createTab'
>

export type OpenSshServerSessionDependencies = {
  getState: () => SshServerSessionState
  connect: (targetId: string) => Promise<SshConnectionState | null>
  browseHome: (targetId: string) => Promise<{ resolvedPath: string }>
  activateFolderWorkspace: (
    folderWorkspaceId: string,
    options: { executionHostId: `ssh:${string}` }
  ) => ActivateAndRevealResult | false
}

export type OpenSshServerSessionResult = {
  folderWorkspaceId: string
  tabId: string
}

function connectionFailure(state: SshConnectionState | null): Error {
  return new Error(
    state?.error?.trim() ||
      translate(
        'auto.components.sidebar.sshServerSession.connectionNotReady',
        'SSH connection did not become ready.'
      )
  )
}

async function ensureConnected(
  targetId: string,
  dependencies: OpenSshServerSessionDependencies
): Promise<void> {
  const current = dependencies.getState().sshConnectionStates.get(targetId)
  if (current?.status === 'connected') {
    return
  }
  const connected = await dependencies.connect(targetId)
  if (connected?.status !== 'connected') {
    throw connectionFailure(connected)
  }
}

function findHomeWorkspace(
  state: SshServerSessionState,
  targetId: string,
  remoteHome: string
): FolderWorkspace | undefined {
  return state.folderWorkspaces.find(
    (workspace) => workspace.connectionId === targetId && workspace.folderPath === remoteHome
  )
}

function findHomeProjectGroup(
  state: SshServerSessionState,
  targetId: string,
  remoteHome: string
): ProjectGroup | undefined {
  return state.projectGroups.find(
    (group) => group.connectionId === targetId && group.parentPath === remoteHome
  )
}

async function ensureHomeWorkspace(
  targetId: string,
  label: string,
  homeWorkspaceName: string,
  remoteHome: string,
  dependencies: OpenSshServerSessionDependencies
): Promise<FolderWorkspace> {
  const existing = findHomeWorkspace(dependencies.getState(), targetId, remoteHome)
  if (existing) {
    return existing
  }

  let group = findHomeProjectGroup(dependencies.getState(), targetId, remoteHome)
  if (!group) {
    group =
      (await dependencies.getState().createProjectGroup(label, {
        parentPath: remoteHome,
        connectionId: targetId,
        runtimeEnvironmentId: null
      })) ?? undefined
  }
  if (!group) {
    throw new Error(
      translate(
        'auto.components.sidebar.sshServerSession.workspaceCreateFailed',
        'Could not create a workspace for this SSH server.'
      )
    )
  }

  const workspace = await dependencies.getState().createFolderWorkspace(
    {
      projectGroupId: group.id,
      name: homeWorkspaceName,
      folderPath: remoteHome,
      connectionId: targetId,
      linkedTask: null
    },
    { runtimeEnvironmentId: null }
  )
  if (!workspace) {
    throw new Error(
      translate(
        'auto.components.sidebar.sshServerSession.workspaceCreateFailed',
        'Could not create a workspace for this SSH server.'
      )
    )
  }
  return workspace
}

export async function openSshServerSession(
  input: { targetId: string; label: string; homeWorkspaceName: string },
  dependencies: OpenSshServerSessionDependencies
): Promise<OpenSshServerSessionResult> {
  await ensureConnected(input.targetId, dependencies)
  const { resolvedPath } = await dependencies.browseHome(input.targetId)
  const remoteHome = resolvedPath.trim()
  if (!remoteHome) {
    throw new Error(
      translate(
        'auto.components.sidebar.sshServerSession.homeUnavailable',
        'The SSH server did not return its home directory.'
      )
    )
  }

  const workspace = await ensureHomeWorkspace(
    input.targetId,
    input.label,
    input.homeWorkspaceName,
    remoteHome,
    dependencies
  )
  const workspaceKey = folderWorkspaceKey(workspace.id)
  const hadTerminal = (dependencies.getState().tabsByWorktree[workspaceKey]?.length ?? 0) > 0
  const activation = dependencies.activateFolderWorkspace(workspace.id, {
    executionHostId: toSshExecutionHostId(input.targetId)
  })
  if (!activation) {
    throw new Error(
      translate(
        'auto.components.sidebar.sshServerSession.workspaceOpenFailed',
        'Could not open the SSH server workspace.'
      )
    )
  }

  const tabId = hadTerminal
    ? dependencies.getState().createTab(workspaceKey).id
    : activation.primaryTabId
  if (!tabId) {
    throw new Error(
      translate(
        'auto.components.sidebar.sshServerSession.terminalOpenFailed',
        'Could not open a terminal for this SSH server.'
      )
    )
  }
  return { folderWorkspaceId: workspace.id, tabId }
}
