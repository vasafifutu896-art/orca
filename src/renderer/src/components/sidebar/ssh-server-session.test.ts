import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { openSshServerSession, type OpenSshServerSessionDependencies } from './ssh-server-session'

const group = {
  id: 'group-1',
  name: 'Builder',
  parentPath: '/home/dev',
  connectionId: 'ssh-1'
} as ProjectGroup
const workspace = {
  id: 'folder-1',
  projectGroupId: group.id,
  name: 'Home',
  folderPath: '/home/dev',
  connectionId: 'ssh-1',
  linkedTask: null
} as FolderWorkspace
const connected = {
  targetId: 'ssh-1',
  status: 'connected',
  error: null,
  reconnectAttempt: 0
} as SshConnectionState

type SessionState = ReturnType<OpenSshServerSessionDependencies['getState']>

function createDependencies() {
  let state!: SessionState
  const createProjectGroup = vi.fn(async () => {
    state = { ...state, projectGroups: [...state.projectGroups, group] }
    return group
  })
  const createFolderWorkspace = vi.fn(async () => {
    state = { ...state, folderWorkspaces: [...state.folderWorkspaces, workspace] }
    return workspace
  })
  const createTab = vi.fn(() => ({ id: 'tab-2' }) as never)
  state = {
    projectGroups: [] as ProjectGroup[],
    folderWorkspaces: [] as FolderWorkspace[],
    tabsByWorktree: {},
    sshConnectionStates: new Map<string, SshConnectionState>(),
    createProjectGroup,
    createFolderWorkspace,
    createTab
  } as unknown as SessionState
  return {
    getState: () => state,
    setState: (patch: Partial<SessionState>) => {
      state = { ...state, ...patch }
    },
    connect: vi.fn(async () => connected),
    browseHome: vi.fn(async () => ({ resolvedPath: '/home/dev' })),
    activateFolderWorkspace: vi.fn(() => ({ primaryTabId: 'tab-1' })),
    createProjectGroup,
    createFolderWorkspace,
    createTab
  }
}

describe('openSshServerSession', () => {
  let dependencies: ReturnType<typeof createDependencies>

  beforeEach(() => {
    dependencies = createDependencies()
  })

  it('connects and creates a persistent home workspace for the first terminal', async () => {
    await expect(
      openSshServerSession(
        { targetId: 'ssh-1', label: 'Builder', homeWorkspaceName: 'Home' },
        dependencies
      )
    ).resolves.toEqual({ folderWorkspaceId: 'folder-1', tabId: 'tab-1' })

    expect(dependencies.connect).toHaveBeenCalledWith('ssh-1')
    expect(dependencies.browseHome).toHaveBeenCalledWith('ssh-1')
    expect(dependencies.createProjectGroup).toHaveBeenCalledWith('Builder', {
      parentPath: '/home/dev',
      connectionId: 'ssh-1',
      runtimeEnvironmentId: null
    })
    expect(dependencies.createFolderWorkspace).toHaveBeenCalledWith(
      {
        projectGroupId: 'group-1',
        name: 'Home',
        folderPath: '/home/dev',
        connectionId: 'ssh-1',
        linkedTask: null
      },
      { runtimeEnvironmentId: null }
    )
    expect(dependencies.createTab).not.toHaveBeenCalled()
  })

  it('opens an additional terminal when the server workspace already has one', async () => {
    dependencies.setState({
      projectGroups: [group],
      folderWorkspaces: [workspace],
      sshConnectionStates: new Map([['ssh-1', connected]]),
      tabsByWorktree: {
        [folderWorkspaceKey(workspace.id)]: [{ id: 'tab-1' } as never]
      }
    })

    await expect(
      openSshServerSession(
        { targetId: 'ssh-1', label: 'Builder', homeWorkspaceName: 'Home' },
        dependencies
      )
    ).resolves.toEqual({ folderWorkspaceId: 'folder-1', tabId: 'tab-2' })

    expect(dependencies.connect).not.toHaveBeenCalled()
    expect(dependencies.createProjectGroup).not.toHaveBeenCalled()
    expect(dependencies.createFolderWorkspace).not.toHaveBeenCalled()
    expect(dependencies.createTab).toHaveBeenCalledWith('folder:folder-1')
  })

  it('does not create a workspace when the SSH connection fails', async () => {
    vi.mocked(dependencies.connect).mockResolvedValue({
      ...connected,
      status: 'auth-failed',
      error: 'Permission denied'
    })

    await expect(
      openSshServerSession(
        { targetId: 'ssh-1', label: 'Builder', homeWorkspaceName: 'Home' },
        dependencies
      )
    ).rejects.toThrow('Permission denied')
    expect(dependencies.browseHome).not.toHaveBeenCalled()
    expect(dependencies.createProjectGroup).not.toHaveBeenCalled()
  })
})
