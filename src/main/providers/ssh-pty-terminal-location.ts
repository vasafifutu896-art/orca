import type {
  PtyTerminalForegroundKind,
  PtyTerminalLocationProbe,
  PtyTerminalLocationReadResult,
  PtyTerminalNestedLocationSource
} from '../../shared/pty-terminal-location'
import {
  sanitizePtyTerminalLocationCwd,
  sanitizePtyTerminalLocationHost
} from '../../shared/pty-terminal-location-observation'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'

const TERMINAL_LOCATION_ID_MAX_LENGTH = 2048
const TERMINAL_LOCATION_CWD_MAX_LENGTH = 4096
const terminalForegroundKinds = new Set<PtyTerminalForegroundKind>([
  'shell',
  'ssh',
  'other',
  'unknown'
])
const terminalNestedLocationSources = new Set<PtyTerminalNestedLocationSource>(['osc7', 'title'])

function hasUnsafeTerminalLocationText(value: string): boolean {
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

function isNullableSafeId(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= TERMINAL_LOCATION_ID_MAX_LENGTH &&
      !hasUnsafeTerminalLocationText(value))
  )
}

function parseNullableHost(value: unknown): { valid: boolean; value: string | null } {
  if (value === null) {
    return { valid: true, value: null }
  }
  if (typeof value !== 'string') {
    return { valid: false, value: null }
  }
  const sanitized = sanitizePtyTerminalLocationHost(value)
  return { valid: sanitized !== null, value: sanitized }
}

function parseNullableCwd(value: unknown): { valid: boolean; value: string | null } {
  if (value === null) {
    return { valid: true, value: null }
  }
  if (typeof value !== 'string') {
    return { valid: false, value: null }
  }
  const sanitized = sanitizePtyTerminalLocationCwd(value)
  return { valid: sanitized !== null, value: sanitized }
}

function parseNestedCwd(value: unknown, source: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const cwd = value.normalize('NFC')
  if (
    source === 'title' &&
    cwd.length <= TERMINAL_LOCATION_CWD_MAX_LENGTH &&
    !hasUnsafeTerminalLocationText(cwd) &&
    (cwd === '~' || cwd.startsWith('~/'))
  ) {
    return cwd
  }
  return sanitizePtyTerminalLocationCwd(cwd)
}

/** Validate the untrusted relay reply before it crosses main's renderer IPC boundary. */
export function parseSshPtyTerminalLocationProbe(value: unknown): PtyTerminalLocationProbe | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const probe = value as Record<string, unknown>
  const foreground = probe.foreground
  if (!foreground || typeof foreground !== 'object') {
    return null
  }
  const foregroundRecord = foreground as Record<string, unknown>
  const foregroundKind = foregroundRecord.kind as PtyTerminalForegroundKind
  const targetHint = parseNullableHost(foregroundRecord.targetHint)
  const outerCwd = parseNullableCwd(probe.outerCwd)
  if (
    !terminalForegroundKinds.has(foregroundKind) ||
    !isNullableSafeId(foregroundRecord.epoch) ||
    !isNullableSafeId(probe.incarnationId) ||
    !targetHint.valid ||
    !outerCwd.valid
  ) {
    return null
  }

  let nestedLocation: PtyTerminalLocationProbe['nestedLocation'] = null
  if (probe.nestedLocation !== null) {
    if (!probe.nestedLocation || typeof probe.nestedLocation !== 'object') {
      return null
    }
    const nested = probe.nestedLocation as Record<string, unknown>
    const cwd = parseNestedCwd(nested.cwd, nested.source)
    const host =
      typeof nested.host === 'string' ? sanitizePtyTerminalLocationHost(nested.host) : null
    if (
      !cwd ||
      !host ||
      !terminalNestedLocationSources.has(nested.source as PtyTerminalNestedLocationSource) ||
      !Number.isSafeInteger(nested.outputSeq) ||
      (nested.outputSeq as number) < 0
    ) {
      return null
    }
    nestedLocation = {
      cwd,
      host,
      source: nested.source as PtyTerminalNestedLocationSource,
      outputSeq: nested.outputSeq as number
    }
  }

  const epoch = foregroundRecord.epoch as string | null
  if (
    (foregroundKind !== 'unknown' && !epoch) ||
    (foregroundKind !== 'ssh' && targetHint.value !== null) ||
    (foregroundKind !== 'ssh' && nestedLocation !== null)
  ) {
    return null
  }

  return {
    incarnationId: probe.incarnationId as string | null,
    foreground: {
      kind: foregroundKind,
      epoch,
      targetHint: targetHint.value
    },
    outerCwd: outerCwd.value,
    nestedLocation
  }
}

export class SshPtyTerminalLocationReader {
  private supported: boolean | undefined

  constructor(private readonly mux: Pick<SshChannelMultiplexer, 'request'>) {}

  async read(relayPtyId: string): Promise<PtyTerminalLocationReadResult> {
    if (this.supported === false) {
      return { status: 'unsupported' }
    }
    try {
      const probe = parseSshPtyTerminalLocationProbe(
        await this.mux.request('pty.getTerminalLocation', { id: relayPtyId })
      )
      this.supported = true
      return probe ? { status: 'available', probe } : { status: 'unavailable' }
    } catch (error) {
      if (isMethodNotFoundError(error)) {
        // Older relays cannot answer this optional display-only probe. Cache
        // the verdict so every visible session does not retry it every 2s.
        this.supported = false
        return { status: 'unsupported' }
      }
      return { status: 'unavailable' }
    }
  }
}
