import { describe, expect, it } from 'vitest'
import {
  parsePtyTerminalOsc7Observation,
  parsePtyTerminalTitleObservation
} from './pty-terminal-location-observation'

describe('PTY terminal location observations', () => {
  it('preserves an OSC 7 host and decoded absolute cwd', () => {
    expect(parsePtyTerminalOsc7Observation('file://build-b/home/me/my%20project')).toEqual({
      host: 'build-b',
      cwd: '/home/me/my project'
    })
    expect(parsePtyTerminalOsc7Observation('file:///C:/Users/me/project')).toEqual({
      host: null,
      cwd: 'C:/Users/me/project'
    })
  })

  it('parses only conservative stock shell titles', () => {
    expect(parsePtyTerminalTitleObservation('root@build-b: /srv/app')).toEqual({
      host: 'build-b',
      cwd: '/srv/app'
    })
    expect(parsePtyTerminalTitleObservation('root@build-b: ~')).toEqual({
      host: 'build-b',
      cwd: '~'
    })
    expect(parsePtyTerminalTitleObservation('root@build-b: ~/app')).toEqual({
      host: 'build-b',
      cwd: '~/app'
    })
    expect(parsePtyTerminalTitleObservation('build-b /srv/app')).toBeNull()
  })

  it.each([
    'file://build-b/home/me/\u202eapp',
    `file://${'a'.repeat(256)}/srv/app`,
    `file://build-b/${'a'.repeat(4097)}`,
    'file://user:password@build-b/srv/app',
    'https://build-b/srv/app'
  ])('rejects unsafe or unsupported OSC 7 input: %s', (uri) => {
    expect(parsePtyTerminalOsc7Observation(uri)).toBeNull()
  })

  it.each([
    'root@build-b: /srv/\u202eapp',
    `root@${'a'.repeat(256)}: /srv/app`,
    'root@build-b: relative/path'
  ])('rejects unsafe title input: %s', (title) => {
    expect(parsePtyTerminalTitleObservation(title)).toBeNull()
  })
})
