import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type SeededSessions = {
  worktreeId: string
  firstTabId: string
  secondTabId: string
  thirdTabId: string
}

async function seedProjectTerminalSessions(page: Page): Promise<SeededSessions> {
  return page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const initial = store.getState()
    initial.setActiveView('terminal')
    initial.setRightSidebarOpen(true)
    initial.setRightSidebarTab('terminal-manager')
    const repo = initial.repos[0]
    const worktree = repo ? initial.worktreesByRepo[repo.id]?.[0] : null
    if (!worktree) {
      throw new Error('Terminal manager test needs a seeded worktree')
    }
    initial.setActiveWorktree(worktree.id)

    while ((store.getState().tabsByWorktree[worktree.id] ?? []).length < 3) {
      store.getState().createTab(worktree.id, undefined, undefined, { activate: false })
    }
    const [first, second, third] = store.getState().tabsByWorktree[worktree.id] ?? []
    if (!first || !second || !third) {
      throw new Error('Could not seed three terminal sessions')
    }
    const state = store.getState()
    state.setTabCustomTitle(first.id, 'Codex implementation')
    state.setTabCustomTitle(second.id, 'Tests')
    state.setTabCustomTitle(third.id, 'Server logs')
    const firstUnified = state.unifiedTabsByWorktree[worktree.id]?.find(
      (tab) => tab.contentType === 'terminal' && tab.entityId === first.id
    )
    if (firstUnified) {
      state.focusGroup(worktree.id, firstUnified.groupId)
      state.activateTab(firstUnified.id, { worktreeId: worktree.id })
    }
    state.setActiveTab(first.id)
    state.setActiveTabType('terminal')

    const workingLeafId = '22222222-2222-4222-8222-222222222222'
    const workingPaneKey = `${second.id}:${workingLeafId}`
    const now = Date.now()
    store.setState((current) => ({
      agentStatusByPaneKey: {
        ...current.agentStatusByPaneKey,
        [workingPaneKey]: {
          state: 'working',
          prompt: 'Run the test suite',
          updatedAt: now,
          stateStartedAt: now,
          agentType: 'codex',
          paneKey: workingPaneKey,
          stateHistory: []
        }
      },
      agentStatusEpoch: current.agentStatusEpoch + 1
    }))
    return {
      worktreeId: worktree.id,
      firstTabId: first.id,
      secondTabId: second.id,
      thirdTabId: third.id
    }
  })
}

test('manages project terminal groups in the right sidebar with live AI state', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const seeded = await seedProjectTerminalSessions(orcaPage)
  const manager = orcaPage.locator(`[data-terminal-manager-workspace="${seeded.worktreeId}"]`)
  const sessions = manager.locator('[data-terminal-manager-session-id]')

  await expect(manager).toBeVisible()
  await expect(sessions).toHaveCount(3)
  await expect(manager.getByText('Codex implementation', { exact: true })).toBeVisible()
  await expect(manager.getByText('Tests', { exact: true })).toBeVisible()
  await expect(manager.getByText('Server logs', { exact: true })).toBeVisible()
  await expect(
    manager.locator(`[data-terminal-manager-session-id="${seeded.secondTabId}"]`)
  ).toHaveAttribute('data-agent-activity-status', 'working')
  await expect(
    manager
      .locator(`[data-terminal-manager-session-id="${seeded.secondTabId}"]`)
      .getByLabel('Working')
  ).toBeVisible()
  await expect(
    orcaPage.locator(`[data-testid="sortable-tab"][data-tab-id="${seeded.firstTabId}"]`)
  ).toHaveCount(0)
  await expect(orcaPage.locator('[data-terminal-session-location="true"]')).toContainText(
    'Codex implementation'
  )

  const completionAlerts = manager.locator('button[aria-pressed]').first()
  const alertsInitiallyEnabled = (await completionAlerts.getAttribute('aria-pressed')) === 'true'
  await completionAlerts.click()
  await expect(completionAlerts).toHaveAttribute(
    'aria-pressed',
    alertsInitiallyEnabled ? 'false' : 'true'
  )
  await completionAlerts.click()
  await expect(completionAlerts).toHaveAttribute(
    'aria-pressed',
    alertsInitiallyEnabled ? 'true' : 'false'
  )

  await manager.getByRole('button', { name: 'New group' }).click()
  await manager.getByRole('textbox', { name: 'Group name' }).fill('Implementation')
  await manager.getByRole('textbox', { name: 'Group name' }).press('Enter')

  const implementationGroup = manager
    .locator('section')
    .filter({ hasText: 'Implementation' })
    .first()
  await expect(implementationGroup).toBeVisible()
  const firstSession = manager.locator(`[data-terminal-manager-session-id="${seeded.firstTabId}"]`)
  await firstSession.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Move to group' }).hover()
  await orcaPage.getByRole('menuitem', { name: 'Implementation', exact: true }).click()
  await expect(
    implementationGroup.locator(`[data-terminal-manager-session-id="${seeded.firstTabId}"]`)
  ).toBeVisible()

  await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarTab('explorer'))
  await expect(manager).toHaveCount(0)
  await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarTab('terminal-manager'))
  const restoredManager = orcaPage.locator(
    `[data-terminal-manager-workspace="${seeded.worktreeId}"]`
  )
  const restoredGroup = restoredManager.locator('section').filter({ hasText: 'Implementation' })
  await expect(restoredGroup.getByText('Codex implementation', { exact: true })).toBeVisible()

  const thirdSession = restoredManager.locator(
    `[data-terminal-manager-session-id="${seeded.thirdTabId}"]`
  )
  await thirdSession.getByRole('button', { name: 'Server logs', exact: true }).click()
  await expect(thirdSession).toHaveAttribute('data-current', 'true')
  await expect(orcaPage.locator('[data-terminal-session-location="true"]')).toContainText(
    'Server logs'
  )
})
