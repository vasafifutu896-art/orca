import { describe, expect, it } from 'vitest'
import { parseOpenSshTargetHint } from './ssh-command-target'

describe('parseOpenSshTargetHint', () => {
  it.each([
    [['ssh', 'build-b'], 'build-b'],
    [['/usr/bin/ssh', 'root@203.0.113.42'], '203.0.113.42'],
    [['ssh', '-tt', '-p', '2222', '-o', 'BatchMode=yes', 'build-b'], 'build-b'],
    [['ssh', '-vp2222', '-Jjump-host', 'root@build-b'], 'build-b'],
    [['ssh', 'ssh://root@build-b:2222'], 'build-b'],
    [['ssh', '--', '[2001:db8::1]'], '[2001:db8::1]']
  ])('extracts a conservative destination from %j', (argv, expected) => {
    expect(parseOpenSshTargetHint(argv)).toBe(expected)
  })

  it.each([
    { argv: ['ssh'] },
    { argv: ['ssh', '-Z', 'build-b'] },
    { argv: ['ssh', '-p'] },
    { argv: ['ssh', `build\u202e-b`] },
    { argv: ['ssh', 'host:port'] }
  ])('rejects an absent or ambiguous destination from $argv', ({ argv }) => {
    expect(parseOpenSshTargetHint(argv)).toBeNull()
  })
})
