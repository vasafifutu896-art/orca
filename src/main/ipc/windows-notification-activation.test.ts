import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildWindowsNotificationActivationArguments,
  buildWindowsNotificationToastXml,
  createWindowsNotificationActivationRouter,
  parseWindowsNotificationActivationArguments,
  relayWindowsNotificationActivation,
  startWindowsNotificationActivationListener,
  type WindowsNotificationActivationListener,
  type WindowsNotificationTarget
} from './windows-notification-activation'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222'
const ROUTE_ONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROUTE_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ROUTE_THREE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ROUTE_FOUR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function tokenSequence(...tokens: string[]): () => string {
  let index = 0
  return () => {
    const token = tokens[index]
    index += 1
    if (!token) {
      throw new Error('Token sequence exhausted')
    }
    return token
  }
}

function listenerHarness(): {
  startListener: (
    ownerId: string,
    canActivateRoute: (routeId: string) => boolean,
    onRoute: (routeId: string) => boolean
  ) => WindowsNotificationActivationListener
  receive: (routeId: string) => void
  close: ReturnType<typeof vi.fn>
} {
  let receive: ((routeId: string) => void) | undefined
  const close = vi.fn()
  return {
    startListener: (_ownerId, canActivateRoute, onRoute) => {
      receive = (routeId) => {
        if (canActivateRoute(routeId)) {
          onRoute(routeId)
        }
      }
      return { ready: Promise.resolve(), close }
    },
    receive: (routeId) => {
      if (!receive) {
        throw new Error('Listener was not started')
      }
      receive(routeId)
    },
    close
  }
}

describe('Windows notification activation payload', () => {
  it('round-trips strict owner and route IDs with the Electron toast tag', () => {
    const activationArguments = buildWindowsNotificationActivationArguments(OWNER, ROUTE_ONE)

    expect(activationArguments).toBe(
      `type=click&tag=${ROUTE_ONE}&orcaOwner=${OWNER}&orcaRoute=${ROUTE_ONE}`
    )
    expect(parseWindowsNotificationActivationArguments(activationArguments)).toEqual({
      ownerId: OWNER,
      routeId: ROUTE_ONE
    })
  })

  it('rejects duplicate, mismatched, malformed, and oversized arguments', () => {
    const valid = buildWindowsNotificationActivationArguments(OWNER, ROUTE_ONE)

    expect(parseWindowsNotificationActivationArguments(`${valid}&type=click`)).toBeNull()
    expect(
      parseWindowsNotificationActivationArguments(
        valid.replace(`tag=${ROUTE_ONE}`, `tag=${ROUTE_TWO}`)
      )
    ).toBeNull()
    expect(
      parseWindowsNotificationActivationArguments(valid.replace(OWNER, '..%5C..%5Cpipe%5Cattacker'))
    ).toBeNull()
    expect(parseWindowsNotificationActivationArguments(`${valid}${'x'.repeat(600)}`)).toBeNull()
    expect(parseWindowsNotificationActivationArguments(undefined)).toBeNull()
    expect(() => buildWindowsNotificationActivationArguments('not-a-uuid', ROUTE_ONE)).toThrow(
      /must be UUIDs/
    )
  })
})

describe('buildWindowsNotificationToastXml', () => {
  it('escapes Korean text, paths, XML delimiters, and invalid XML characters', () => {
    const activationArguments = buildWindowsNotificationActivationArguments(OWNER, ROUTE_ONE)
    const xml = buildWindowsNotificationToastXml({
      title: `작업 완료 & C:\\프로젝트\\A=B <끝> "확인" '\u0001\ud800`,
      body: '경로=C:\\tmp\\a&b=1 /=',
      activationArguments,
      silent: true
    })

    expect(xml).toContain(
      `<toast launch="type=click&amp;tag=${ROUTE_ONE}&amp;orcaOwner=${OWNER}&amp;orcaRoute=${ROUTE_ONE}">`
    )
    expect(xml).toContain(
      '<text>작업 완료 &amp; C:\\프로젝트\\A=B &lt;끝&gt; &quot;확인&quot; &apos;��</text>'
    )
    expect(xml).toContain('<text>경로=C:\\tmp\\a&amp;b=1 /=</text>')
    expect(xml).toContain('<audio silent="true"/>')
    expect(xml).not.toContain('activationType=')
  })

  it('omits silent audio and rejects untrusted launch arguments', () => {
    const activationArguments = buildWindowsNotificationActivationArguments(OWNER, ROUTE_ONE)

    expect(
      buildWindowsNotificationToastXml({ title: '완료', body: '본문', activationArguments })
    ).not.toContain('<audio')
    expect(() =>
      buildWindowsNotificationToastXml({
        title: '완료',
        body: '본문',
        activationArguments: 'type=click&orcaOwner=bad'
      })
    ).toThrow(/Invalid Windows notification activation arguments/)
  })
})

describe('createWindowsNotificationActivationRouter', () => {
  it('relays a wrong-process callback to the owner and activates only its exact target', async () => {
    const receivers = new Map<
      string,
      { canActivateRoute: (routeId: string) => boolean; onRoute: (routeId: string) => boolean }
    >()
    const startListener = (
      ownerId: string,
      canActivateRoute: (routeId: string) => boolean,
      onRoute: (routeId: string) => boolean
    ): WindowsNotificationActivationListener => {
      receivers.set(ownerId, { canActivateRoute, onRoute })
      return { ready: Promise.resolve(), close: () => void receivers.delete(ownerId) }
    }
    const relay = (ownerId: string, routeId: string): boolean => {
      const receiver = receivers.get(ownerId)
      if (!receiver?.canActivateRoute(routeId)) {
        return false
      }
      return receiver.onRoute(routeId)
    }
    const ownerActivate = vi.fn(() => true)
    const receiverActivate = vi.fn(() => true)
    const owner = createWindowsNotificationActivationRouter({
      activateTarget: ownerActivate,
      relay,
      startListener,
      token: tokenSequence(OWNER, ROUTE_ONE)
    })
    const receiver = createWindowsNotificationActivationRouter({
      activateTarget: receiverActivate,
      relay,
      startListener,
      token: tokenSequence(OTHER_OWNER)
    })
    const target = {
      worktreeId: 'folder:8449c2be-30a2-4d24-a732-b37da8a9b07c',
      paneKey: 'tab-2:11111111-1111-4111-8111-111111111111'
    }
    const registration = owner.registerTarget(target)

    await expect(
      receiver.handleActivationArguments(registration.activationArguments)
    ).resolves.toBe('relayed')
    expect(receiverActivate).not.toHaveBeenCalled()
    expect(ownerActivate).toHaveBeenCalledOnce()
    expect(ownerActivate).toHaveBeenCalledWith(target)
    expect(registration.activate()).toBe('missing')
  })

  it('relays wrong-owner activation without activating the current process', async () => {
    const activateTarget = vi.fn(() => true)
    const relay = vi.fn(async () => true)
    const harness = listenerHarness()
    const router = createWindowsNotificationActivationRouter({
      activateTarget,
      relay,
      startListener: harness.startListener,
      token: tokenSequence(OWNER)
    })
    const argumentsFromOtherProcess = buildWindowsNotificationActivationArguments(
      OTHER_OWNER,
      ROUTE_ONE
    )

    await expect(router.handleActivationArguments(argumentsFromOtherProcess)).resolves.toBe(
      'relayed'
    )
    expect(relay).toHaveBeenCalledWith(OTHER_OWNER, ROUTE_ONE)
    expect(activateTarget).not.toHaveBeenCalled()
  })

  it('fails closed when wrong-owner relay is unavailable or rejects', async () => {
    const activateTarget = vi.fn(() => true)
    const warn = vi.fn()
    const activationArguments = buildWindowsNotificationActivationArguments(OTHER_OWNER, ROUTE_ONE)
    for (const relay of [
      vi.fn(async () => false),
      vi.fn(async () => {
        throw new Error('pipe unavailable')
      })
    ]) {
      const router = createWindowsNotificationActivationRouter({
        activateTarget,
        relay,
        warn,
        startListener: listenerHarness().startListener,
        token: tokenSequence(OWNER)
      })
      await expect(router.handleActivationArguments(activationArguments)).resolves.toBe(
        'relay-failed'
      )
    }
    expect(activateTarget).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('consumes a local route once across direct and listener activation', async () => {
    const activateTarget = vi.fn(() => true)
    const harness = listenerHarness()
    const router = createWindowsNotificationActivationRouter({
      activateTarget,
      startListener: harness.startListener,
      token: tokenSequence(OWNER, ROUTE_ONE)
    })
    const registration = router.registerTarget({
      worktreeId: 'repo::C:\\프로젝트',
      paneKey: 'tab:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })

    harness.receive(registration.routeId)
    expect(registration.activate()).toBe('missing')
    await expect(router.handleActivationArguments(registration.activationArguments)).resolves.toBe(
      'missing'
    )
    expect(activateTarget).toHaveBeenCalledTimes(1)
    expect(activateTarget).toHaveBeenCalledWith({
      worktreeId: 'repo::C:\\프로젝트',
      paneKey: 'tab:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
  })

  it('keeps failed activation pending and retries it only during flush', async () => {
    const activateTarget = vi
      .fn()
      .mockReturnValueOnce('navigation-pending')
      .mockReturnValueOnce(true)
    const harness = listenerHarness()
    const router = createWindowsNotificationActivationRouter({
      activateTarget,
      startListener: harness.startListener,
      token: tokenSequence(OWNER, ROUTE_ONE)
    })
    const registration = router.registerTarget({ worktreeId: 'repo::/worktree' })

    expect(registration.activate()).toBe('pending')
    await expect(router.handleActivationArguments(registration.activationArguments)).resolves.toBe(
      'pending'
    )
    expect(activateTarget).toHaveBeenCalledTimes(1)

    router.flush()
    expect(activateTarget).toHaveBeenCalledTimes(2)
    expect(registration.activate()).toBe('missing')
  })

  it('flushes queued navigation in click order rather than notification creation order', () => {
    let rendererReady = false
    const activateTarget = vi.fn((_target: WindowsNotificationTarget) =>
      rendererReady ? true : ('navigation-pending' as const)
    )
    const router = createWindowsNotificationActivationRouter({
      activateTarget,
      startListener: listenerHarness().startListener,
      token: tokenSequence(OWNER, ROUTE_ONE, ROUTE_TWO)
    })
    const createdFirst = router.registerTarget({ worktreeId: 'repo::created-first' })
    const createdSecond = router.registerTarget({ worktreeId: 'repo::created-second' })

    expect(createdSecond.activate()).toBe('pending')
    expect(createdFirst.activate()).toBe('pending')
    rendererReady = true
    router.flush()

    expect(activateTarget.mock.calls.slice(2).map(([target]) => target.worktreeId)).toEqual([
      'repo::created-second',
      'repo::created-first'
    ])
  })

  it('evicts the oldest route at the bound and expires routes by TTL', () => {
    let now = 100
    const harness = listenerHarness()
    const router = createWindowsNotificationActivationRouter({
      activateTarget: () => true,
      startListener: harness.startListener,
      token: tokenSequence(OWNER, ROUTE_ONE, ROUTE_TWO, ROUTE_THREE, ROUTE_FOUR),
      now: () => now,
      maxRoutes: 2,
      routeTtlMs: 10
    })
    const first = router.registerTarget({ worktreeId: 'repo::one' })
    const second = router.registerTarget({ worktreeId: 'repo::two' })
    const third = router.registerTarget({ worktreeId: 'repo::three' })

    expect(first.activate()).toBe('missing')
    expect(second.activate()).toBe('activated')
    now = 110
    expect(third.activate()).toBe('missing')

    const fourth = router.registerTarget({ worktreeId: 'repo::four' })
    fourth.discard()
    expect(fourth.activate()).toBe('missing')
  })

  it('rejects empty and oversized target fields', () => {
    const router = createWindowsNotificationActivationRouter({
      activateTarget: () => true,
      startListener: listenerHarness().startListener,
      token: tokenSequence(OWNER, ROUTE_ONE, ROUTE_TWO, ROUTE_THREE)
    })

    expect(() => router.registerTarget({ worktreeId: '' })).toThrow(
      /Invalid Windows notification target/
    )
    expect(() => router.registerTarget({ worktreeId: 'x'.repeat(32 * 1_024 + 1) })).toThrow(
      /Invalid Windows notification target/
    )
    expect(() =>
      router.registerTarget({ worktreeId: 'repo::valid', paneKey: 'x'.repeat(1_025) })
    ).toThrow(/Invalid Windows notification target/)
  })

  it('rejects invalid route bounds and listener owner IDs', () => {
    const create = (maxRoutes: number, routeTtlMs: number) =>
      createWindowsNotificationActivationRouter({
        activateTarget: () => true,
        startListener: listenerHarness().startListener,
        token: tokenSequence(OWNER),
        maxRoutes,
        routeTtlMs
      })

    expect(() => create(0, 1)).toThrow(/Invalid Windows notification route bounds/)
    expect(() => create(1.5, 1)).toThrow(/Invalid Windows notification route bounds/)
    expect(() => create(1, 0)).toThrow(/Invalid Windows notification route bounds/)
    expect(() => create(1, Number.NaN)).toThrow(/Invalid Windows notification route bounds/)
    expect(() =>
      startWindowsNotificationActivationListener(
        '..\\pipe\\other',
        () => true,
        () => true
      )
    ).toThrow(/owner token must be a UUID/)
  })

  it('exposes listener readiness and closes the pipe listener', async () => {
    const harness = listenerHarness()
    const router = createWindowsNotificationActivationRouter({
      activateTarget: () => true,
      startListener: harness.startListener,
      token: tokenSequence(OWNER)
    })

    await expect(router.ready).resolves.toBe(true)
    router.close()
    expect(harness.close).toHaveBeenCalledOnce()
  })

  it('reports an unavailable listener without leaving a rejected startup promise', async () => {
    const warn = vi.fn()
    const router = createWindowsNotificationActivationRouter({
      activateTarget: () => true,
      startListener: () => {
        throw new Error('pipe bind failed')
      },
      token: tokenSequence(OWNER),
      warn
    })

    await expect(router.ready).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(
      '[notifications] Activation listener readiness failed',
      expect.any(Error)
    )
  })
})

describe('Windows notification activation transport', () => {
  it.runIf(process.platform === 'win32')(
    'delivers an opaque route over the real named pipe and stops after close',
    async () => {
      const ownerId = randomUUID()
      const routeId = randomUUID()
      const received: string[] = []
      const order: string[] = []
      const listener = startWindowsNotificationActivationListener(
        ownerId,
        (candidateRouteId) => candidateRouteId === routeId,
        (receivedRouteId) => {
          order.push('commit')
          received.push(receivedRouteId)
          return true
        }
      )

      await listener.ready
      await expect(
        relayWindowsNotificationActivation(ownerId, routeId, (ownerPid) => {
          expect(ownerPid).toBe(process.pid)
          order.push('grant')
          return true
        })
      ).resolves.toBe(true)
      expect(received).toEqual([routeId])
      expect(order).toEqual(['grant', 'commit'])

      listener.close()
      await expect(
        relayWindowsNotificationActivation(ownerId, randomUUID(), () => true)
      ).resolves.toBe(false)
      expect(received).toEqual([routeId])
    }
  )

  it.runIf(process.platform === 'win32')(
    'commits to the exact owner even when foreground permission degrades',
    async () => {
      const ownerId = randomUUID()
      const routeId = randomUUID()
      const received: string[] = []
      const listener = startWindowsNotificationActivationListener(
        ownerId,
        (candidateRouteId) => candidateRouteId === routeId,
        (receivedRouteId) => {
          received.push(receivedRouteId)
          return true
        }
      )

      await listener.ready
      await expect(
        relayWindowsNotificationActivation(ownerId, routeId, () => false, vi.fn())
      ).resolves.toBe(true)
      expect(received).toEqual([routeId])

      listener.close()
    }
  )

  it.runIf(process.platform === 'win32')(
    'contains synchronous foreground grant failures and still routes to the exact owner',
    async () => {
      const ownerId = randomUUID()
      const routeId = randomUUID()
      const commit = vi.fn(() => true)
      const listener = startWindowsNotificationActivationListener(ownerId, () => true, commit)

      await listener.ready
      await expect(
        relayWindowsNotificationActivation(
          ownerId,
          routeId,
          () => {
            throw new Error('native grant failed')
          },
          vi.fn()
        )
      ).resolves.toBe(true)
      expect(commit).toHaveBeenCalledOnce()

      listener.close()
    }
  )
})
