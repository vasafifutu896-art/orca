const MAX_TERMINAL_LOCATION_HOST_CHARS = 255
const MAX_TERMINAL_LOCATION_CWD_CHARS = 4096
const MAX_OSC7_URI_CHARS = 16_384
const MAX_SHELL_TITLE_CHARS = 1024
const SAFE_HOST = /^(?:\[[0-9a-f:.%]+\]|[a-z0-9](?:[a-z0-9._-]{0,253}[a-z0-9])?)$/i
const ABSOLUTE_WINDOWS_CWD = /^(?:[a-z]:[\\/]|\\\\[^\\])/i
const SHELL_TITLE_LOCATION = /^([a-z0-9._-]+)@(\[[^\]]+\]|[^:\s]+):[ \t]+(.+)$/i

export type PtyTerminalLocationObservation = {
  cwd: string
  host: string | null
}

export function hasUnsafePtyTerminalLocationText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x061c ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x206f) ||
      codePoint === 0xfeff
    ) {
      return true
    }
  }
  return false
}

export function sanitizePtyTerminalLocationHost(value: string): string | null {
  const host = value.trim().normalize('NFC')
  if (
    !host ||
    host.length > MAX_TERMINAL_LOCATION_HOST_CHARS ||
    hasUnsafePtyTerminalLocationText(host) ||
    !SAFE_HOST.test(host)
  ) {
    return null
  }
  return host
}

export function sanitizePtyTerminalLocationCwd(value: string): string | null {
  let cwd = value.normalize('NFC')
  if (/^\/[a-z]:\//i.test(cwd)) {
    cwd = cwd.slice(1)
  }
  if (
    !cwd ||
    cwd.length > MAX_TERMINAL_LOCATION_CWD_CHARS ||
    hasUnsafePtyTerminalLocationText(cwd) ||
    (!cwd.startsWith('/') && !ABSOLUTE_WINDOWS_CWD.test(cwd))
  ) {
    return null
  }
  return cwd
}

function sanitizePtyTerminalTitleCwd(value: string): string | null {
  const cwd = value.normalize('NFC')
  if (
    cwd.length > 0 &&
    cwd.length <= MAX_TERMINAL_LOCATION_CWD_CHARS &&
    !hasUnsafePtyTerminalLocationText(cwd) &&
    (cwd === '~' || cwd.startsWith('~/'))
  ) {
    return cwd
  }
  return sanitizePtyTerminalLocationCwd(cwd)
}

export function parsePtyTerminalOsc7Observation(
  uri: string
): PtyTerminalLocationObservation | null {
  if (!uri || uri.length > MAX_OSC7_URI_CHARS || hasUnsafePtyTerminalLocationText(uri)) {
    return null
  }
  try {
    const parsed = new URL(uri)
    if (
      parsed.protocol !== 'file:' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    const cwd = sanitizePtyTerminalLocationCwd(decodeURIComponent(parsed.pathname))
    if (!cwd) {
      return null
    }
    const host = parsed.hostname ? sanitizePtyTerminalLocationHost(parsed.hostname) : null
    if (parsed.hostname && !host) {
      return null
    }
    return { cwd, host }
  } catch {
    return null
  }
}

export function parsePtyTerminalTitleObservation(
  title: string
): PtyTerminalLocationObservation | null {
  if (!title || title.length > MAX_SHELL_TITLE_CHARS || hasUnsafePtyTerminalLocationText(title)) {
    return null
  }
  const match = SHELL_TITLE_LOCATION.exec(title)
  if (!match) {
    return null
  }
  const host = sanitizePtyTerminalLocationHost(match[2] ?? '')
  // Stock Debian/Ubuntu bash titles use `\w`, which renders the remote home
  // as `~`. This value is display-only; OSC 7 and RPC routing remain absolute.
  const cwd = sanitizePtyTerminalTitleCwd(match[3] ?? '')
  return host && cwd ? { host, cwd } : null
}
