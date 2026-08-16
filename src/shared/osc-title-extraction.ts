const ESC_CODE_UNIT = 0x1b
const BEL_CODE_UNIT = 0x07
const RIGHT_BRACKET_CODE_UNIT = 0x5d
const BACKSLASH_CODE_UNIT = 0x5c
const SEMICOLON_CODE_UNIT = 0x3b
const OSC_TITLE_COMMANDS = new Set([0x30, 0x31, 0x32])
export const MAX_OSC_TITLE_CHARS = 1024
export const MAX_OSC_TITLES_PER_CHUNK = 4096

export type ExtractedOscTitle = {
  endIndex: number
  index: number
  title: string
  truncated: boolean
}

type OscTitleParseResult =
  | { kind: 'title'; nextIndex: number; index: number; title: string; truncated: boolean }
  | { kind: 'invalid'; nextIndex: number }
  | { kind: 'incomplete' }

function isOscIntroducerAt(data: string, index: number): boolean {
  return (
    data.charCodeAt(index) === ESC_CODE_UNIT &&
    data.charCodeAt(index + 1) === RIGHT_BRACKET_CODE_UNIT
  )
}

function parseOscTitleAt(data: string, index: number): OscTitleParseResult {
  if (!isOscIntroducerAt(data, index)) {
    return { kind: 'invalid', nextIndex: index + 1 }
  }
  if (
    !OSC_TITLE_COMMANDS.has(data.charCodeAt(index + 2)) ||
    data.charCodeAt(index + 3) !== SEMICOLON_CODE_UNIT
  ) {
    return { kind: 'invalid', nextIndex: index + 2 }
  }

  const titleStart = index + 4
  for (let cursor = titleStart; cursor < data.length; cursor += 1) {
    const code = data.charCodeAt(cursor)
    if (code === BEL_CODE_UNIT) {
      return {
        kind: 'title',
        index,
        ...readBoundedOscTitle(data, titleStart, cursor),
        nextIndex: cursor + 1
      }
    }
    if (code !== ESC_CODE_UNIT) {
      continue
    }
    if (data.charCodeAt(cursor + 1) === BACKSLASH_CODE_UNIT) {
      return {
        kind: 'title',
        index,
        ...readBoundedOscTitle(data, titleStart, cursor),
        nextIndex: cursor + 2
      }
    }
    return { kind: 'invalid', nextIndex: cursor }
  }

  return { kind: 'incomplete' }
}

function readBoundedOscTitle(
  data: string,
  titleStart: number,
  titleEnd: number
): Omit<ExtractedOscTitle, 'endIndex' | 'index'> {
  // Why: PTY output can contain pasted or remote-controlled OSC titles; keep
  // downstream title detection bounded while preserving trailing status words.
  const length = titleEnd - titleStart
  if (length <= MAX_OSC_TITLE_CHARS) {
    return { title: data.slice(titleStart, titleEnd), truncated: false }
  }
  const prefixLength = Math.ceil(MAX_OSC_TITLE_CHARS / 2)
  const suffixLength = MAX_OSC_TITLE_CHARS - prefixLength
  return {
    title:
      data.slice(titleStart, titleStart + prefixLength) +
      data.slice(titleEnd - suffixLength, titleEnd),
    truncated: true
  }
}

export function extractLastOscTitle(data: string): string | null {
  if (!data.includes('\x1b]')) {
    return null
  }

  let last: string | null = null
  let searchStart = 0
  // Why: raw PTY chunks can include large pasted content. Parse OSC titles
  // directly instead of running a global regex over the whole chunk.
  while (searchStart < data.length) {
    const start = data.indexOf('\x1b]', searchStart)
    if (start === -1) {
      break
    }
    const parsed = parseOscTitleAt(data, start)
    if (parsed.kind === 'incomplete') {
      break
    }
    if (parsed.kind === 'title') {
      last = parsed.title
      searchStart = parsed.nextIndex
      continue
    }
    searchStart = parsed.nextIndex
  }
  return last
}

export function extractAllOscTitlesWithMetadata(data: string): ExtractedOscTitle[] {
  if (!data.includes('\x1b]')) {
    return []
  }

  const titles: ExtractedOscTitle[] = []
  let oldestTitleIndex = 0
  let searchStart = 0
  while (searchStart < data.length) {
    const start = data.indexOf('\x1b]', searchStart)
    if (start === -1) {
      break
    }
    const parsed = parseOscTitleAt(data, start)
    if (parsed.kind === 'incomplete') {
      break
    }
    if (parsed.kind === 'title') {
      if (titles.length < MAX_OSC_TITLES_PER_CHUNK) {
        titles.push({
          endIndex: parsed.nextIndex,
          index: parsed.index,
          title: parsed.title,
          truncated: parsed.truncated
        })
      } else {
        titles[oldestTitleIndex] = {
          endIndex: parsed.nextIndex,
          index: parsed.index,
          title: parsed.title,
          truncated: parsed.truncated
        }
        oldestTitleIndex = (oldestTitleIndex + 1) % MAX_OSC_TITLES_PER_CHUNK
      }
      searchStart = parsed.nextIndex
      continue
    }
    searchStart = parsed.nextIndex
  }
  return oldestTitleIndex === 0
    ? titles
    : [...titles.slice(oldestTitleIndex), ...titles.slice(0, oldestTitleIndex)]
}

export function extractAllOscTitles(data: string): string[] {
  return extractAllOscTitlesWithMetadata(data).map(({ title }) => title)
}
