import { describe, it, expect } from 'vitest'
import { parseOsc7 } from './parse-osc7'

describe('parseOsc7', () => {
  it('extracts a plain POSIX path', () => {
    expect(parseOsc7('file://host/home/jin/repo')).toBe('/home/jin/repo')
  })

  it('accepts an empty host', () => {
    expect(parseOsc7('file:///home/jin')).toBe('/home/jin')
  })

  it('percent-decodes spaces and unicode', () => {
    expect(parseOsc7('file:///home/jin/my%20code')).toBe('/home/jin/my code')
  })

  it('strips the leading slash before a Windows drive letter', () => {
    expect(parseOsc7('file:///C:/Users/jin/repo')).toBe('C:/Users/jin/repo')
  })

  it('preserves Windows UNC cwd paths', () => {
    expect(parseOsc7('file://server/share/project', { uncHost: 'server' })).toBe(
      '\\\\server\\share\\project'
    )
  })

  it('accepts a new UNC host after a local Windows pane starts on a drive', () => {
    expect(parseOsc7('file:////fileserver/team/project', { windowsUncPath: true })).toBe(
      '\\\\fileserver\\team\\project'
    )
  })

  it('keeps host-qualified paths POSIX for Git Bash and remote Linux shells', () => {
    expect(parseOsc7('file://workstation/c/Users/jin/repo', { windowsUncPath: true })).toBe(
      '/c/Users/jin/repo'
    )
  })

  it('does not treat unrelated OSC-7 hosts as UNC servers', () => {
    expect(parseOsc7('file://remote/home/jin/repo', { uncHost: 'server' })).toBe('/home/jin/repo')
  })

  it('keeps POSIX host-prefixed paths unchanged by default', () => {
    expect(parseOsc7('file://server/share/project')).toBe('/share/project')
  })

  it('returns null for non-file URIs', () => {
    expect(parseOsc7('http://example.com/')).toBeNull()
  })

  it('returns null for unterminated/malformed input', () => {
    expect(parseOsc7('not a uri')).toBeNull()
    expect(parseOsc7('file://host')).toBeNull()
  })

  it('returns null for invalid percent-encoding', () => {
    expect(parseOsc7('file:///bad%ZZ')).toBeNull()
  })
})
