import { describe, expect, it, vi } from 'vitest'

const readRuntimeDirectory = vi.fn()
vi.mock('@/runtime/runtime-file-client', () => ({
  readRuntimeDirectory: (...args: unknown[]) => readRuntimeDirectory(...args)
}))
vi.mock('./file-explorer-operation-owner', () => ({
  getFileExplorerOperationOwner: () => ({ kind: 'local' }),
  getFileExplorerOperationRoute: () => ({ settings: null, connectionId: null }),
  getFileExplorerOwnerUnresolvedMessage: () => 'unresolved'
}))

import {
  fileExplorerEntriesToTreeNodes,
  readFileExplorerDirectory
} from './file-explorer-directory-listing'

describe('readFileExplorerDirectory', () => {
  it('re-sorts backend order — remote-runtime and paired-web routes return the host order verbatim', async () => {
    readRuntimeDirectory.mockResolvedValueOnce([
      { name: '100 - b.txt', isDirectory: false, isSymlink: false },
      { name: '9 - c.txt', isDirectory: false, isSymlink: false },
      { name: '10 - dir', isDirectory: true, isSymlink: false },
      { name: '99 - a.txt', isDirectory: false, isSymlink: false }
    ])

    const { entries } = await readFileExplorerDirectory('wt-1', '/w', '/w/dir')
    expect(entries.map((e) => e.name)).toEqual([
      '10 - dir',
      '9 - c.txt',
      '99 - a.txt',
      '100 - b.txt'
    ])
  })
})

describe('fileExplorerEntriesToTreeNodes', () => {
  it('keeps an absolute identity when direct SSH browsing leaves Home', () => {
    const [node] = fileExplorerEntriesToTreeNodes(
      [{ name: 'hosts', isDirectory: false, isSymlink: false }],
      '/etc',
      -1,
      '/home/dev',
      { kind: 'ssh', connectionId: 'ssh-1' }
    )

    expect(node.path).toBe('/etc/hosts')
    expect(node.relativePath).toBe('/etc/hosts')
  })
})
