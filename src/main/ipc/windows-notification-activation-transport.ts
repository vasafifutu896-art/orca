import { createConnection, createServer, type Socket } from 'node:net'
import { grantWindowsForegroundPermission } from './windows-foreground-permission'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_PIPE_FRAME_BYTES = 512
const PIPE_TIMEOUT_MS = 2_000
let relayQueue: Promise<void> = Promise.resolve()

export type WindowsNotificationActivationWarn = (message: string, error?: unknown) => void
export type WindowsNotificationActivationListener = {
  ready: Promise<void>
  close: () => void
}
export type WindowsNotificationForegroundGrant = (targetPid: number) => boolean | Promise<boolean>

type PipeFrame = Record<string, unknown>

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && UUID_RE.test(value)
}

function isPid(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 0xffff_ffff
}

function pipePath(ownerId: string): string {
  return `\\\\.\\pipe\\orca-notification-${ownerId}`
}

function canonicalFrame(value: PipeFrame): string {
  return `${JSON.stringify(value)}\n`
}

function parseCanonicalFrame(frame: Buffer, expected: PipeFrame): boolean {
  if (frame.byteLength > MAX_PIPE_FRAME_BYTES || frame.at(-1) !== 0x0a) {
    return false
  }
  return frame.toString('utf8') === canonicalFrame(expected)
}

function createFrameReader(
  socket: Socket,
  maxFrames: number,
  onFrame: (frame: Buffer) => void
): void {
  let buffered = Buffer.alloc(0)
  let frameCount = 0
  const deadline = setTimeout(() => socket.destroy(), PIPE_TIMEOUT_MS)
  deadline.unref()
  socket.once('close', () => clearTimeout(deadline))
  socket.on('error', () => {})
  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk], buffered.byteLength + chunk.byteLength)
    if (buffered.byteLength > MAX_PIPE_FRAME_BYTES) {
      socket.destroy()
      return
    }
    let newlineIndex = buffered.indexOf(0x0a)
    while (newlineIndex !== -1) {
      frameCount += 1
      if (frameCount > maxFrames) {
        socket.destroy()
        return
      }
      const frame = buffered.subarray(0, newlineIndex + 1)
      buffered = buffered.subarray(newlineIndex + 1)
      onFrame(frame)
      if (socket.destroyed) {
        return
      }
      newlineIndex = buffered.indexOf(0x0a)
    }
  })
}

export function startWindowsNotificationActivationListener(
  ownerId: string,
  canActivateRoute: (routeId: string) => boolean,
  onRoute: (routeId: string) => boolean,
  warn: WindowsNotificationActivationWarn = console.warn,
  ownerPid = process.pid
): WindowsNotificationActivationListener {
  if (!isUuid(ownerId)) {
    throw new Error('Windows notification owner token must be a UUID')
  }
  if (!isPid(ownerPid)) {
    throw new Error('Windows notification owner PID must be valid')
  }
  if (process.platform !== 'win32') {
    return { ready: Promise.resolve(), close: () => {} }
  }
  const sockets = new Set<Socket>()
  const leases = new Map<string, Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.setNoDelay(true)
    let preparedRouteId: string | null = null
    socket.once('close', () => {
      sockets.delete(socket)
      if (preparedRouteId && leases.get(preparedRouteId) === socket) {
        leases.delete(preparedRouteId)
      }
    })
    createFrameReader(socket, 2, (frame) => {
      if (!preparedRouteId) {
        let routeId: unknown
        try {
          routeId = (JSON.parse(frame.subarray(0, -1).toString('utf8')) as { routeId?: unknown })
            .routeId
        } catch {
          socket.destroy()
          return
        }
        const prepare = { v: 1, type: 'prepare', ownerId, routeId }
        if (
          !isUuid(routeId) ||
          !parseCanonicalFrame(frame, prepare) ||
          leases.has(routeId) ||
          !canActivateRoute(routeId)
        ) {
          socket.end()
          return
        }
        preparedRouteId = routeId
        leases.set(routeId, socket)
        socket.write(canonicalFrame({ v: 1, type: 'prepared', ownerId, routeId, pid: ownerPid }))
        return
      }
      const commit = { v: 1, type: 'commit', ownerId, routeId: preparedRouteId }
      if (!parseCanonicalFrame(frame, commit)) {
        socket.destroy()
        return
      }
      const routeId = preparedRouteId
      preparedRouteId = null
      leases.delete(routeId)
      if (!onRoute(routeId)) {
        socket.end()
        return
      }
      socket.end(canonicalFrame({ v: 1, type: 'committed', ownerId, routeId }))
    })
  })
  let resolveReady = (): void => {}
  let rejectReady = (_error: unknown): void => {}
  let closed = false
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  server.once('listening', () => {
    resolveReady()
    if (closed) {
      server.close()
    }
  })
  server.on('error', (error) => {
    warn('[notifications] Activation pipe listener failed', error)
    rejectReady(error)
  })
  server.listen({
    path: pipePath(ownerId),
    exclusive: true,
    readableAll: false,
    writableAll: false
  })
  server.unref()
  return {
    ready,
    close: () => {
      closed = true
      resolveReady()
      sockets.forEach((socket) => socket.destroy())
      if (server.listening) {
        server.close()
      }
    }
  }
}

async function relayWindowsNotificationActivationOnce(
  ownerId: string,
  routeId: string,
  grantForeground: WindowsNotificationForegroundGrant,
  warn: WindowsNotificationActivationWarn
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(pipePath(ownerId))
    let state: 'awaiting-prepared' | 'granting' | 'awaiting-committed' = 'awaiting-prepared'
    let settled = false
    const settle = (delivered: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      resolve(delivered)
    }
    socket.unref()
    socket.setNoDelay(true)
    socket.on('error', () => settle(false))
    socket.on('connect', () =>
      socket.write(canonicalFrame({ v: 1, type: 'prepare', ownerId, routeId }))
    )
    createFrameReader(socket, 2, (frame) => {
      if (state === 'awaiting-prepared') {
        let pid: unknown
        try {
          pid = (JSON.parse(frame.subarray(0, -1).toString('utf8')) as { pid?: unknown }).pid
        } catch {
          settle(false)
          return
        }
        const prepared = { v: 1, type: 'prepared', ownerId, routeId, pid }
        if (!isPid(pid) || !parseCanonicalFrame(frame, prepared)) {
          settle(false)
          return
        }
        state = 'granting'
        const commit = (): void => {
          if (!settled && !socket.destroyed) {
            state = 'awaiting-committed'
            socket.write(canonicalFrame({ v: 1, type: 'commit', ownerId, routeId }))
          }
        }
        let grantResult: boolean | Promise<boolean>
        try {
          grantResult = grantForeground(pid)
        } catch (error) {
          warn('[notifications] Windows foreground permission grant failed', error)
          commit()
          return
        }
        void Promise.resolve(grantResult)
          .then((granted) => {
            if (!granted) {
              warn('[notifications] Windows foreground permission grant was denied')
            }
            commit()
          })
          .catch((error) => {
            warn('[notifications] Windows foreground permission grant failed', error)
            commit()
          })
        return
      }
      if (state !== 'awaiting-committed') {
        settle(false)
        return
      }
      const committed = { v: 1, type: 'committed', ownerId, routeId }
      settle(parseCanonicalFrame(frame, committed))
    })
    socket.on('close', () => settle(false))
  })
}

export function relayWindowsNotificationActivation(
  ownerId: string,
  routeId: string,
  grantForeground: WindowsNotificationForegroundGrant = (targetPid) =>
    grantWindowsForegroundPermission(targetPid).granted,
  warn: WindowsNotificationActivationWarn = console.warn
): Promise<boolean> {
  if (process.platform !== 'win32' || !isUuid(ownerId) || !isUuid(routeId)) {
    return Promise.resolve(false)
  }
  const run = () => relayWindowsNotificationActivationOnce(ownerId, routeId, grantForeground, warn)
  const result = relayQueue.then(run, run)
  relayQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}
