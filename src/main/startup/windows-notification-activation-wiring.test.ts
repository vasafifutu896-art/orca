import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Windows notification activation wiring', () => {
  const mainSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
  const rendererSource = readFileSync(
    join(process.cwd(), 'src/renderer/src/hooks/useIpcEvents.ts'),
    'utf8'
  )
  const appSource = readFileSync(join(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
  const readinessHookSource = readFileSync(
    join(process.cwd(), 'src/renderer/src/hooks/use-notification-activation-ready.ts'),
    'utf8'
  )

  it('registers the global COM callback and routes it through the per-process owner', () => {
    const routerIndex = mainSource.indexOf('createWindowsNotificationActivationRouter({')
    const lockIndex = mainSource.indexOf('acquireSingleInstanceLock(app, requestDesktopActivation)')
    const appIdIndex = mainSource.indexOf(
      'electronApp.setAppUserModelId(devInstanceIdentity.appUserModelId)'
    )
    const handlerIndex = mainSource.indexOf('Notification.handleActivation(', appIdIndex)

    expect(routerIndex).toBeGreaterThanOrEqual(0)
    expect(routerIndex).toBeLessThan(lockIndex)
    expect(handlerIndex).toBeGreaterThan(appIdIndex)
    expect(mainSource.slice(handlerIndex, handlerIndex + 300)).toContain(
      'windowsNotificationActivationRouter.handleActivationArguments(details.arguments)'
    )
    // Why: Notification.isSupported() constructs the Windows presenter/shortcut/COM activator;
    // dispatch creates it lazily, so startup must not pay that cost for every instance.
    expect(mainSource.slice(handlerIndex, handlerIndex + 400)).not.toContain(
      'Notification.isSupported()'
    )
  })

  it('flushes queued navigation only after the trusted renderer attaches listeners', () => {
    const readyHandlerIndex = mainSource.indexOf("ipcMain.handle('ui:notificationActivationReady'")
    expect(readyHandlerIndex).toBeGreaterThanOrEqual(0)
    const readyHandler = mainSource.slice(readyHandlerIndex, readyHandlerIndex + 550)
    expect(readyHandler).toContain('mainWindow.webContents.id !== event.sender.id')
    expect(readyHandler).toContain('notificationRendererReady = true')
    expect(readyHandler).toContain('windowsNotificationActivationRouter.flush()')

    const listenerLatchIndex = rendererSource.indexOf('onListenersReady?.(true)')
    const focusListenerIndex = rendererSource.indexOf('window.api.ui.onFocusTerminal(')
    expect(listenerLatchIndex).toBeGreaterThan(focusListenerIndex)
    expect(appSource).toContain(
      'useNotificationActivationReady(ipcEventListenersReady, workspaceSessionReady)'
    )
    const gateIndex = readinessHookSource.indexOf(
      'if (!ipcEventListenersReady || !workspaceSessionReady)'
    )
    const frameIndex = readinessHookSource.indexOf('window.requestAnimationFrame(', gateIndex)
    const signalIndex = readinessHookSource.indexOf(
      'window.api.ui.signalNotificationActivationReady?.()',
      frameIndex
    )
    expect(gateIndex).toBeGreaterThanOrEqual(0)
    expect(frameIndex).toBeGreaterThan(gateIndex)
    expect(signalIndex).toBeGreaterThan(frameIndex)
  })

  it('passes the same router to notification creation and closes it with the process', () => {
    expect(mainSource).toContain('{ windowsNotificationActivationRouter }')
    expect(mainSource).toContain("app.once('will-quit', windowsNotificationActivationRouter.close)")
    expect(mainSource).toContain("process.once('exit', windowsNotificationActivationRouter.close)")
  })
})
