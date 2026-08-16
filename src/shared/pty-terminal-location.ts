export type PtyTerminalForegroundKind = 'shell' | 'ssh' | 'other' | 'unknown'

export type PtyTerminalForeground = {
  kind: PtyTerminalForegroundKind
  epoch: string | null
  targetHint: string | null
}

export type PtyTerminalNestedLocationSource = 'osc7' | 'title'

export type PtyTerminalNestedLocation = {
  cwd: string
  host: string
  source: PtyTerminalNestedLocationSource
  outputSeq: number
}

export type PtyTerminalLocationProbe = {
  incarnationId: string | null
  foreground: PtyTerminalForeground
  outerCwd: string | null
  nestedLocation: PtyTerminalNestedLocation | null
}

export type PtyTerminalLocationReadResult =
  | { status: 'available'; probe: PtyTerminalLocationProbe }
  | { status: 'unsupported' }
  | { status: 'unavailable' }

export const UNKNOWN_PTY_TERMINAL_FOREGROUND: PtyTerminalForeground = Object.freeze({
  kind: 'unknown',
  epoch: null,
  targetHint: null
})
