import { extractAllOscTitlesWithMetadata } from '../shared/osc-title-extraction'
import {
  parsePtyTerminalOsc7Observation,
  parsePtyTerminalTitleObservation,
  type PtyTerminalLocationObservation
} from '../shared/pty-terminal-location-observation'
import type {
  PtyTerminalForeground,
  PtyTerminalNestedLocation,
  PtyTerminalNestedLocationSource
} from '../shared/pty-terminal-location'
import { extractOscScanTail, scanOsc7Uris } from '../main/daemon/osc7-uri-extraction'

const OSC_SCAN_TAIL_LIMIT = 4096
const LOCATION_OSC_PREFIXES = ['\x1b]0;', '\x1b]1;', '\x1b]2;', '\x1b]7;'] as const

type PendingTerminalLocationObservation = PtyTerminalLocationObservation & {
  source: PtyTerminalNestedLocationSource
  outputSeq: number
  revision: number
}

type IndexedTerminalLocationObservation = Omit<
  PendingTerminalLocationObservation,
  'outputSeq' | 'revision'
> & { endIndex: number; index: number }

type EpochBoundLocation = {
  epoch: string
  observationRevision: number
  location: PtyTerminalNestedLocation
}

/**
 * Extracts display-only nested locations from remote output. The OS process
 * probe remains authoritative for whether an ssh process currently owns the
 * PTY; output can only describe a location inside that validated ssh epoch.
 */
export class PtyTerminalLocationTracker {
  private scanTail = ''
  private scanEpoch: string | null = null
  private observationRevision = 0
  private boundLocation: EpochBoundLocation | null = null

  shouldScan(data: string): boolean {
    // Most PTY chunks are ordinary program output. Avoid a synchronous /proc
    // foreground probe unless this chunk can start or complete an OSC signal.
    if (this.scanTail.length > 0 || LOCATION_OSC_PREFIXES.some((prefix) => data.includes(prefix))) {
      return true
    }
    const lastEscape = data.lastIndexOf('\x1b')
    if (lastEscape === -1) {
      return false
    }
    const suffix = data.slice(lastEscape)
    return LOCATION_OSC_PREFIXES.some((prefix) => prefix.startsWith(suffix))
  }

  scan(
    data: string,
    outputSeq: number,
    foreground: PtyTerminalForeground
  ): PendingTerminalLocationObservation | null {
    const foregroundEpoch = foreground.kind === 'ssh' ? foreground.epoch : null
    if (!foregroundEpoch) {
      this.scanTail = ''
      this.scanEpoch = null
      return null
    }
    if (this.scanEpoch !== foregroundEpoch) {
      // An incomplete escape from the prior process must never be completed by
      // output from a replacement ssh process that inherited the same PTY.
      this.scanTail = ''
      this.scanEpoch = foregroundEpoch
    }
    if (this.scanTail.length === 0 && !data.includes('\x1b]')) {
      this.scanTail = data.endsWith('\x1b') ? extractOscScanTail(data, OSC_SCAN_TAIL_LIMIT) : ''
      return null
    }

    const input = this.scanTail.length === 0 ? data : this.scanTail + data
    this.scanTail = extractOscScanTail(input, OSC_SCAN_TAIL_LIMIT)
    const inputStartSeq = Math.max(0, outputSeq - input.length)
    const observations: IndexedTerminalLocationObservation[] = []

    scanOsc7Uris(input, (uri, index, endIndex) => {
      const parsed = parsePtyTerminalOsc7Observation(uri)
      if (!parsed) {
        return
      }
      observations.push({
        ...parsed,
        source: 'osc7',
        endIndex,
        index
      })
    })

    for (const { endIndex, index, title, truncated } of extractAllOscTitlesWithMetadata(input)) {
      if (truncated) {
        continue
      }
      const parsed = parsePtyTerminalTitleObservation(title)
      if (!parsed) {
        continue
      }
      observations.push({
        ...parsed,
        source: 'title',
        endIndex,
        index
      })
    }

    let lastObservation: PendingTerminalLocationObservation | null = null
    let lastExplicitHost: string | null = null
    observations.sort((left, right) => left.index - right.index)
    for (const observation of observations) {
      // Every valid occurrence gets a new revision, even if the host/path is
      // unchanged. The same prompt can then bind after ssh reconnects with a
      // fresh foreground epoch. Raw byte order, not arbitrary chunk grouping,
      // decides which of multiple valid signals is current.
      this.observationRevision += 1
      if (observation.host) {
        lastExplicitHost = observation.host
      }
      lastObservation = {
        cwd: observation.cwd,
        host: observation.host ?? lastExplicitHost,
        source: observation.source,
        outputSeq: inputStartSeq + observation.endIndex,
        revision: this.observationRevision
      }
    }
    return lastObservation
  }

  bind(observation: PendingTerminalLocationObservation, foreground: PtyTerminalForeground): void {
    if (foreground.kind !== 'ssh' || !foreground.epoch) {
      return
    }
    const host =
      observation.host ??
      (this.boundLocation?.epoch === foreground.epoch
        ? this.boundLocation.location.host
        : foreground.targetHint)
    if (!host) {
      return
    }
    this.boundLocation = {
      epoch: foreground.epoch,
      observationRevision: observation.revision,
      location: {
        cwd: observation.cwd,
        host,
        source: observation.source,
        outputSeq: observation.outputSeq
      }
    }
  }

  nestedLocationFor(foreground: PtyTerminalForeground): PtyTerminalNestedLocation | null {
    if (
      foreground.kind !== 'ssh' ||
      !foreground.epoch ||
      this.boundLocation?.epoch !== foreground.epoch
    ) {
      return null
    }
    return this.boundLocation.location
  }
}
