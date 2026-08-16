import {
  hasUnsafePtyTerminalLocationText,
  sanitizePtyTerminalLocationHost
} from './pty-terminal-location-observation'

const SSH_FLAGS = new Set('46AaCfGgKkMNnqsTtVvXxYy')
const SSH_OPTIONS_WITH_VALUE = new Set('BbcDEeFIiJLlmOoPpQRSWw')
const MAX_SSH_DESTINATION_CHARS = 1024

function normalizeSshDestination(destination: string): string | null {
  if (
    !destination ||
    destination.length > MAX_SSH_DESTINATION_CHARS ||
    hasUnsafePtyTerminalLocationText(destination)
  ) {
    return null
  }
  if (destination.startsWith('ssh://')) {
    try {
      const parsed = new URL(destination)
      return parsed.protocol === 'ssh:' ? sanitizePtyTerminalLocationHost(parsed.hostname) : null
    } catch {
      return null
    }
  }

  const host = destination.slice(destination.lastIndexOf('@') + 1)
  const normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return sanitizePtyTerminalLocationHost(normalizedHost)
}

export function parseOpenSshTargetHint(argv: readonly string[]): string | null {
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg) {
      continue
    }
    if (arg === '--') {
      return normalizeSshDestination(argv[index + 1] ?? '')
    }
    if (!arg.startsWith('-') || arg === '-') {
      return normalizeSshDestination(arg)
    }
    if (arg.startsWith('--')) {
      return null
    }

    const options = arg.slice(1)
    for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      const option = options[optionIndex]
      if (!option) {
        return null
      }
      if (SSH_FLAGS.has(option)) {
        continue
      }
      if (!SSH_OPTIONS_WITH_VALUE.has(option)) {
        return null
      }
      if (optionIndex === options.length - 1) {
        index += 1
        if (!argv[index]) {
          return null
        }
      }
      break
    }
  }
  return null
}
