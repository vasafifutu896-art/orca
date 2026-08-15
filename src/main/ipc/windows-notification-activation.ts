import { randomUUID } from 'node:crypto'
import {
  relayWindowsNotificationActivation,
  startWindowsNotificationActivationListener,
  type WindowsNotificationActivationListener,
  type WindowsNotificationActivationWarn
} from './windows-notification-activation-transport'

export {
  relayWindowsNotificationActivation,
  startWindowsNotificationActivationListener
} from './windows-notification-activation-transport'
export type { WindowsNotificationActivationListener } from './windows-notification-activation-transport'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_ACTIVATION_ARGUMENT_BYTES = 512
const DEFAULT_MAX_ROUTES = 256
const DEFAULT_ROUTE_TTL_MS = 24 * 60 * 60 * 1_000
const LIVE_ROUTE_GRACE_MS = 60_000
const MAX_WORKTREE_ID_BYTES = 32 * 1_024
const MAX_PANE_KEY_BYTES = 1_024
// oxlint-disable-next-line no-control-regex -- XML 1.0 explicitly permits tab, LF, and CR while rejecting other controls.
const XML_INVALID_RE = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu

export type WindowsNotificationTarget = { worktreeId: string; paneKey?: string }
export type WindowsNotificationTargetActivationResult =
  | boolean
  | 'activated'
  | 'navigation-pending'
  | 'unavailable'

type Warn = WindowsNotificationActivationWarn
export type WindowsNotificationActivationRouterOptions = {
  activateTarget: (target: WindowsNotificationTarget) => WindowsNotificationTargetActivationResult
  token?: () => string
  now?: () => number
  startListener?: typeof startWindowsNotificationActivationListener
  relay?: (ownerId: string, routeId: string) => boolean | Promise<boolean>
  warn?: Warn
  maxRoutes?: number
  routeTtlMs?: number
}

type RouteRecord = {
  target: WindowsNotificationTarget
  expiresAt: number
  pending: boolean
  pendingSequence?: number
  consumeWhenActivated: boolean
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && UUID_RE.test(value)
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= maxBytes
}

function validateTarget(target: WindowsNotificationTarget): WindowsNotificationTarget {
  if (
    !isBoundedText(target.worktreeId, MAX_WORKTREE_ID_BYTES) ||
    (target.paneKey !== undefined && !isBoundedText(target.paneKey, MAX_PANE_KEY_BYTES))
  ) {
    throw new Error('Invalid Windows notification target')
  }
  return { ...target }
}

export function buildWindowsNotificationActivationArguments(
  ownerId: string,
  routeId: string
): string {
  if (!isUuid(ownerId) || !isUuid(routeId)) {
    throw new Error('Windows notification activation IDs must be UUIDs')
  }
  return `type=click&tag=${routeId}&orcaOwner=${ownerId}&orcaRoute=${routeId}`
}

export function parseWindowsNotificationActivationArguments(
  raw: unknown
): { ownerId: string; routeId: string } | null {
  if (!isBoundedText(raw, MAX_ACTIVATION_ARGUMENT_BYTES)) {
    return null
  }
  const params = new URLSearchParams(raw)
  const ownerId = params.get('orcaOwner')
  const routeId = params.get('orcaRoute')
  if (!isUuid(ownerId) || !isUuid(routeId)) {
    return null
  }
  return raw === buildWindowsNotificationActivationArguments(ownerId, routeId)
    ? { ownerId, routeId }
    : null
}

function escapeXml(value: string): string {
  return value
    .replace(XML_INVALID_RE, '\ufffd')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildWindowsNotificationToastXml(options: {
  title: string
  body: string
  activationArguments: string
  silent?: boolean
}): string {
  if (!parseWindowsNotificationActivationArguments(options.activationArguments)) {
    throw new Error('Invalid Windows notification activation arguments')
  }
  return `<toast launch="${escapeXml(options.activationArguments)}"><visual><binding template="ToastGeneric"><text>${escapeXml(options.title)}</text><text>${escapeXml(options.body)}</text></binding></visual>${options.silent ? '<audio silent="true"/>' : ''}</toast>`
}

function safelyStartListener(
  start: () => WindowsNotificationActivationListener
): WindowsNotificationActivationListener {
  try {
    return start()
  } catch (error) {
    return { ready: Promise.reject(error), close: () => {} }
  }
}

export function createWindowsNotificationActivationRouter(
  options: WindowsNotificationActivationRouterOptions
) {
  const token = options.token ?? randomUUID
  const now = options.now ?? Date.now
  const warn = options.warn ?? console.warn
  const maxRoutes = options.maxRoutes ?? DEFAULT_MAX_ROUTES
  const routeTtlMs = options.routeTtlMs ?? DEFAULT_ROUTE_TTL_MS
  if (
    !Number.isInteger(maxRoutes) ||
    maxRoutes <= 0 ||
    !Number.isFinite(routeTtlMs) ||
    routeTtlMs <= 0
  ) {
    throw new Error('Invalid Windows notification route bounds')
  }
  const ownerId = token()
  if (!isUuid(ownerId)) {
    throw new Error('Windows notification owner token must be a UUID')
  }
  const routes = new Map<string, RouteRecord>()
  let activationSequence = 0

  const prune = (): void => {
    const currentTime = now()
    routes.forEach((record, routeId) =>
      record.expiresAt <= currentTime ? routes.delete(routeId) : undefined
    )
  }
  const activateRoute = (routeId: string, retainForCom = false) => {
    prune()
    const record = routes.get(routeId)
    if (!record) {
      return 'missing' as const
    }
    const wasPending = record.pending
    record.pending = true
    record.consumeWhenActivated ||= !retainForCom
    try {
      const result = options.activateTarget(record.target)
      if (result === true || result === 'activated') {
        record.pending = false
        record.pendingSequence = undefined
        if (!retainForCom || record.consumeWhenActivated) {
          routes.delete(routeId)
        } else {
          record.expiresAt = Math.min(record.expiresAt, now() + LIVE_ROUTE_GRACE_MS)
        }
        return 'activated' as const
      }
      if (result === 'navigation-pending') {
        if (!wasPending) {
          activationSequence += 1
          record.pendingSequence = activationSequence
        }
        return 'pending' as const
      }
      record.pending = wasPending
      return 'unavailable' as const
    } catch (error) {
      record.pending = wasPending
      warn('[notifications] Failed to activate notification target', error)
      return 'unavailable' as const
    }
  }
  const startListener = options.startListener ?? startWindowsNotificationActivationListener
  const listener = safelyStartListener(() =>
    startListener(
      ownerId,
      (routeId) => {
        prune()
        return routes.has(routeId)
      },
      (routeId) => {
        const result = activateRoute(routeId)
        return result === 'activated' || result === 'pending'
      },
      warn
    )
  )

  return {
    ownerId,
    ready: listener.ready.then(
      () => true,
      (error) => {
        warn('[notifications] Activation listener readiness failed', error)
        return false
      }
    ),
    registerTarget: (target) => {
      prune()
      while (routes.size >= maxRoutes) {
        routes.delete(routes.keys().next().value!)
      }
      const routeId = token()
      if (!isUuid(routeId) || routes.has(routeId)) {
        throw new Error('Failed to create a unique Windows notification route')
      }
      routes.set(routeId, {
        target: validateTarget(target),
        expiresAt: now() + routeTtlMs,
        pending: false,
        consumeWhenActivated: false
      })
      return {
        routeId,
        activationArguments: buildWindowsNotificationActivationArguments(ownerId, routeId),
        activate: () => activateRoute(routeId),
        activateLive: () => activateRoute(routeId, true),
        discard: () => void routes.delete(routeId)
      }
    },
    handleActivationArguments: async (raw) => {
      const activation = parseWindowsNotificationActivationArguments(raw)
      if (!activation) {
        return 'invalid' as const
      }
      if (activation.ownerId === ownerId) {
        return activateRoute(activation.routeId)
      }
      try {
        const delivered = await (options.relay ?? relayWindowsNotificationActivation)(
          activation.ownerId,
          activation.routeId
        )
        if (delivered) {
          return 'relayed' as const
        }
      } catch (error) {
        warn('[notifications] Failed to relay notification activation', error)
      }
      warn('[notifications] Notification activation owner is unavailable')
      return 'relay-failed'
    },
    flush: () => {
      prune()
      const pendingRoutes = [...routes.entries()]
        .filter(([, record]) => record.pending)
        .sort(([, left], [, right]) => (left.pendingSequence ?? 0) - (right.pendingSequence ?? 0))
      for (const [routeId, record] of pendingRoutes) {
        activateRoute(routeId, !record.consumeWhenActivated)
      }
    },
    close: () => {
      routes.clear()
      listener.close()
    }
  }
}

type CreateRouter = typeof createWindowsNotificationActivationRouter
export type WindowsNotificationActivationRouter = ReturnType<CreateRouter>
