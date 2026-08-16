import { describe, expect, it } from 'vitest'
import type { PtyTerminalForeground } from '../shared/pty-terminal-location'
import { PtyTerminalLocationTracker } from './pty-terminal-location-tracker'

const SSH_A: PtyTerminalForeground = {
  kind: 'ssh',
  epoch: '200:20',
  targetHint: 'build-a'
}
const SSH_A_RECONNECTED: PtyTerminalForeground = {
  kind: 'ssh',
  epoch: '205:25',
  targetHint: 'build-a'
}
const SHELL: PtyTerminalForeground = {
  kind: 'shell',
  epoch: '100:10',
  targetHint: null
}

function scanAndBind(
  tracker: PtyTerminalLocationTracker,
  data: string,
  outputSeq: number,
  foreground: PtyTerminalForeground
): void {
  const observation = tracker.scan(data, outputSeq, foreground)
  if (observation) {
    tracker.bind(observation, foreground)
  }
}

describe('PtyTerminalLocationTracker', () => {
  it('only requests a foreground probe for possible OSC location data', () => {
    const tracker = new PtyTerminalLocationTracker()

    expect(tracker.shouldScan('ordinary command output')).toBe(false)
    expect(tracker.shouldScan('\x1b]8;;https://example.test\x1b\\link')).toBe(false)
    expect(tracker.shouldScan('\x1b]52;c;Y2xpcGJvYXJk\x07')).toBe(false)
    expect(tracker.shouldScan('\x1b]0;root@build-b: /srv/app\x07')).toBe(true)
    expect(tracker.shouldScan('\x1b]7;file://build-b/srv/app\x07')).toBe(true)
    expect(tracker.shouldScan('split introducer\x1b')).toBe(true)
    expect(tracker.shouldScan('split command\x1b]7')).toBe(true)
    expect(tracker.scan('\x1b', 1, SSH_A)).toBeNull()
    expect(tracker.shouldScan(']7;file://build-b/srv/app\x07')).toBe(true)
  })

  it('binds a split OSC 7 observation to the current ssh epoch', () => {
    const tracker = new PtyTerminalLocationTracker()
    expect(tracker.scan('\x1b]7;file://build-b/srv/', 24, SSH_A)).toBeNull()
    scanAndBind(tracker, 'app\x07', 28, SSH_A)

    expect(tracker.nestedLocationFor(SSH_A)).toEqual({
      host: 'build-b',
      cwd: '/srv/app',
      source: 'osc7',
      outputSeq: 28
    })
  })

  it('uses the validated ssh target when hostless OSC 7 describes the cwd', () => {
    const tracker = new PtyTerminalLocationTracker()
    scanAndBind(tracker, '\x1b]7;file:///home/me\x07', 23, SSH_A)
    expect(tracker.nestedLocationFor(SSH_A)).toMatchObject({
      host: 'build-a',
      cwd: '/home/me',
      source: 'osc7'
    })
  })

  it('accepts stock title locations, including home-relative display paths', () => {
    const tracker = new PtyTerminalLocationTracker()
    scanAndBind(tracker, '\x1b]0;root@build-b: ~/app\x07', 31, SSH_A)
    expect(tracker.nestedLocationFor(SSH_A)).toEqual({
      host: 'build-b',
      cwd: '~/app',
      source: 'title',
      outputSeq: 31
    })
  })

  it('lets a later title describe a deeper nested ssh host in the same outer epoch', () => {
    const tracker = new PtyTerminalLocationTracker()
    scanAndBind(tracker, '\x1b]7;file://build-a/home/me\x07', 32, SSH_A)
    scanAndBind(tracker, '\x1b]0;root@build-b: /srv/app\x07', 65, SSH_A)
    expect(tracker.nestedLocationFor(SSH_A)).toEqual({
      host: 'build-b',
      cwd: '/srv/app',
      source: 'title',
      outputSeq: 65
    })
  })

  it('keeps the last explicit inner host when its later OSC 7 is hostless', () => {
    const title = '\x1b]0;root@build-c: /srv/app\x07'
    const hostlessOsc7 = '\x1b]7;file:///srv/app/packages/api\x07'
    const bytes = title + hostlessOsc7
    const oneChunk = new PtyTerminalLocationTracker()
    scanAndBind(oneChunk, bytes, bytes.length, SSH_A)

    const splitChunks = new PtyTerminalLocationTracker()
    scanAndBind(splitChunks, title, title.length, SSH_A)
    scanAndBind(splitChunks, hostlessOsc7, bytes.length, SSH_A)

    expect(oneChunk.nestedLocationFor(SSH_A)).toEqual(splitChunks.nestedLocationFor(SSH_A))
    expect(oneChunk.nestedLocationFor(SSH_A)).toEqual({
      host: 'build-c',
      cwd: '/srv/app/packages/api',
      source: 'osc7',
      outputSeq: bytes.length
    })
  })

  it('uses raw signal order consistently when one read contains OSC 7 and a title', () => {
    const tracker = new PtyTerminalLocationTracker()
    scanAndBind(tracker, '\x1b]7;file://build-b/srv/app\x07\x1b]0;root@wrong: /tmp\x07', 55, SSH_A)
    expect(tracker.nestedLocationFor(SSH_A)).toMatchObject({
      host: 'wrong',
      cwd: '/tmp',
      source: 'title'
    })
  })

  it('produces the same latest location regardless of PTY chunk boundaries', () => {
    const bytes = '\x1b]7;file://build-b/home/me\x07\x1b]0;root@build-c: /srv/app\x07'
    const oneChunk = new PtyTerminalLocationTracker()
    scanAndBind(oneChunk, bytes, bytes.length, SSH_A)

    const splitChunks = new PtyTerminalLocationTracker()
    const splitAt = bytes.indexOf('\x1b]0;')
    scanAndBind(splitChunks, bytes.slice(0, splitAt), splitAt, SSH_A)
    scanAndBind(splitChunks, bytes.slice(splitAt), bytes.length, SSH_A)

    expect(oneChunk.nestedLocationFor(SSH_A)).toEqual(splitChunks.nestedLocationFor(SSH_A))
    expect(oneChunk.nestedLocationFor(SSH_A)).toMatchObject({
      host: 'build-c',
      cwd: '/srv/app',
      source: 'title'
    })
  })

  it.each([
    ['OSC 7', '\x1b]7;file://build-b/srv/app\x1b\\'],
    ['title', '\x1b]0;root@build-c: ~/x\x1b\\']
  ])('preserves a split ST terminator for %s', (_label, bytes) => {
    const oneChunk = new PtyTerminalLocationTracker()
    scanAndBind(oneChunk, bytes, bytes.length, SSH_A)

    const splitChunks = new PtyTerminalLocationTracker()
    const splitAt = bytes.length - 1
    scanAndBind(splitChunks, bytes.slice(0, splitAt), splitAt, SSH_A)
    scanAndBind(splitChunks, bytes.slice(splitAt), bytes.length, SSH_A)

    expect(splitChunks.nestedLocationFor(SSH_A)).toEqual(oneChunk.nestedLocationFor(SSH_A))
  })

  it('hides stale nested state on ssh exit and until a fresh epoch emits evidence', () => {
    const tracker = new PtyTerminalLocationTracker()
    const prompt = '\x1b]7;file://build-b/srv/app\x07'
    scanAndBind(tracker, prompt, 32, SSH_A)
    expect(tracker.nestedLocationFor(SHELL)).toBeNull()
    expect(tracker.nestedLocationFor(SSH_A_RECONNECTED)).toBeNull()

    // Identical output is still a new observation and can bind the new epoch.
    scanAndBind(tracker, prompt, 64, SSH_A_RECONNECTED)
    expect(tracker.nestedLocationFor(SSH_A_RECONNECTED)).toEqual({
      host: 'build-b',
      cwd: '/srv/app',
      source: 'osc7',
      outputSeq: 64
    })
  })

  it('does not complete an escape sequence across ssh foreground epochs', () => {
    const tracker = new PtyTerminalLocationTracker()

    expect(tracker.scan('\x1b]7;file://old.example/srv/', 32, SSH_A)).toBeNull()
    scanAndBind(tracker, 'stale\x07', 39, SSH_A_RECONNECTED)

    expect(tracker.nestedLocationFor(SSH_A_RECONNECTED)).toBeNull()
  })

  it('never binds unsafe output or output observed outside ssh', () => {
    const tracker = new PtyTerminalLocationTracker()
    scanAndBind(tracker, '\x1b]0;root@build-b: /srv/\u202eapp\x07', 31, SSH_A)
    scanAndBind(tracker, '\x1b]7;file://build-b/srv/app\x07', 62, SHELL)
    expect(tracker.nestedLocationFor(SSH_A)).toBeNull()
  })

  it('rejects an oversized title instead of binding a spliced synthetic path', () => {
    const tracker = new PtyTerminalLocationTracker()
    const oversizedPath = `/srv/${'a'.repeat(2_000)}`

    scanAndBind(tracker, `\x1b]0;root@build-b: ${oversizedPath}\x07`, 2_050, SSH_A)

    expect(tracker.nestedLocationFor(SSH_A)).toBeNull()
  })
})
