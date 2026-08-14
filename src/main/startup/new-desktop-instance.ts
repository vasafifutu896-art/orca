import { spawn } from 'node:child_process'
import { MULTI_INSTANCE_SLOT_ARG_PREFIX } from './multi-instance-profile'

type DesktopInstanceChild = {
  once: (event: 'error', listener: (error: Error) => void) => unknown
  unref: () => void
}

type DesktopInstanceSpawner = (
  executable: string,
  args: readonly string[],
  options: { detached: true; stdio: 'ignore' }
) => DesktopInstanceChild

const spawnDesktopInstance: DesktopInstanceSpawner = (executable, args, options) =>
  spawn(executable, [...args], options)

export function launchNewDesktopInstance(
  options: {
    executable?: string
    argv?: readonly string[]
    env?: NodeJS.ProcessEnv
    spawn?: DesktopInstanceSpawner
    onError?: (error: Error) => void
  } = {}
): boolean {
  try {
    const portableExecutable = (options.env ?? process.env).PORTABLE_EXECUTABLE_FILE?.trim()
    const executable = options.executable ?? (portableExecutable || process.execPath)
    const argv = options.argv ?? process.argv
    const args = argv.slice(1).filter((arg) => !arg.startsWith(MULTI_INSTANCE_SLOT_ARG_PREFIX))
    const child = (options.spawn ?? spawnDesktopInstance)(executable, args, {
      detached: true,
      stdio: 'ignore'
    })
    child.once('error', (error) => {
      options.onError?.(error)
      console.error('[multi-instance] Failed to launch a new Orca window:', error)
    })
    child.unref()
    return true
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    options.onError?.(normalized)
    console.error('[multi-instance] Failed to launch a new Orca window:', normalized)
    return false
  }
}
