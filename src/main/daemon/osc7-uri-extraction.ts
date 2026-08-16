const OSC7_PREFIX = '\x1b]7;'
const ESC_CODE_UNIT = 0x1b
const BEL_CODE_UNIT = 0x07
const BACKSLASH_CODE_UNIT = 0x5c

type Osc7ParseResult =
  | { kind: 'uri'; uri: string; nextIndex: number }
  | { kind: 'invalid'; nextIndex: number }
  | { kind: 'incomplete' }

function parseOsc7At(data: string, index: number): Osc7ParseResult {
  if (!data.startsWith(OSC7_PREFIX, index)) {
    return { kind: 'invalid', nextIndex: index + 1 }
  }

  const uriStart = index + OSC7_PREFIX.length
  for (let cursor = uriStart; cursor < data.length; cursor += 1) {
    const code = data.charCodeAt(cursor)
    if (code === BEL_CODE_UNIT) {
      return { kind: 'uri', uri: data.slice(uriStart, cursor), nextIndex: cursor + 1 }
    }
    if (code !== ESC_CODE_UNIT) {
      continue
    }
    if (data.charCodeAt(cursor + 1) === BACKSLASH_CODE_UNIT) {
      return { kind: 'uri', uri: data.slice(uriStart, cursor), nextIndex: cursor + 2 }
    }
    return { kind: 'invalid', nextIndex: cursor }
  }

  return { kind: 'incomplete' }
}

export function scanOsc7Uris(
  data: string,
  onUri: (uri: string, index: number, endIndex: number) => void
): void {
  if (!data.includes(OSC7_PREFIX)) {
    return
  }

  let searchStart = 0
  while (searchStart < data.length) {
    const start = data.indexOf(OSC7_PREFIX, searchStart)
    if (start === -1) {
      break
    }

    const parsed = parseOsc7At(data, start)
    if (parsed.kind === 'incomplete') {
      break
    }
    if (parsed.kind === 'uri') {
      onUri(parsed.uri, start, parsed.nextIndex)
      searchStart = parsed.nextIndex
      continue
    }
    searchStart = parsed.nextIndex
  }
}

export function extractLastOsc7Uri(data: string): string | null {
  let lastUri: string | null = null
  scanOsc7Uris(data, (uri) => {
    lastUri = uri
  })

  return lastUri
}

export function extractOscScanTail(input: string, limit: number): string {
  const lastOsc = input.lastIndexOf('\x1b]')
  if (lastOsc !== -1) {
    const oscSuffix = input.slice(lastOsc)
    if (!oscSuffix.includes('\x07') && !oscSuffix.includes('\x1b\\')) {
      // A final ESC may be the first half of this open OSC's ST terminator.
      // Keep the whole bounded OSC, not only that ESC, across the chunk split.
      return oscSuffix.slice(-limit)
    }
  }

  return input.endsWith('\x1b') ? '\x1b' : ''
}
