import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type SeededSessions = {
  worktreeId: string
  firstTabId: string
  secondTabId: string
  thirdTabId: string
}

async function dragWithPointer(
  page: Page,
  source: ReturnType<Page['locator']>,
  target: ReturnType<Page['locator']>
): Promise<void> {
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Terminal manager drag source or target is not visible')
  }
  const sourceX = sourceBox.x + sourceBox.width / 2
  const sourceY = sourceBox.y + sourceBox.height / 2
  const targetX = targetBox.x + targetBox.width / 2
  const targetY = targetBox.y + targetBox.height / 2
  await page.mouse.move(sourceX, sourceY)
  await page.mouse.down()
  await page.mouse.move(sourceX + 8, sourceY)
  await page.mouse.move(targetX, targetY, { steps: 2 })
  await page.mouse.up()
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
  await expect(manager.getByRole('checkbox')).toHaveCount(0)
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

  const completionAlerts = manager.getByRole('button', { name: 'AI completion alerts' })
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
  const implementationGroupId = await implementationGroup.getAttribute(
    'data-terminal-manager-group-id'
  )
  if (!implementationGroupId) {
    throw new Error('Created terminal manager group has no id')
  }
  const createdGroup = manager.locator(
    `[data-terminal-manager-group-id="${implementationGroupId}"]`
  )

  await createdGroup.getByText('Implementation', { exact: true }).click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Rename group' }).click()
  const renameGroupInput = manager.getByRole('textbox', { name: 'Rename group Implementation' })
  await expect(renameGroupInput).toBeVisible()
  await renameGroupInput.fill('Core work')
  await renameGroupInput.press('Enter')
  await expect(createdGroup.getByText('Core work', { exact: true })).toBeVisible()

  await manager.getByRole('button', { name: 'New group' }).click()
  await manager.getByRole('textbox', { name: 'Group name' }).fill('Review')
  await manager.getByRole('textbox', { name: 'Group name' }).press('Enter')
  const reviewGroup = manager.locator('section').filter({ hasText: 'Review' }).first()
  const reviewGroupId = await reviewGroup.getAttribute('data-terminal-manager-group-id')
  if (!reviewGroupId) {
    throw new Error('Second terminal manager group has no id')
  }
  const namedGroups = manager.locator(
    '[data-terminal-manager-group-id]:not([data-terminal-manager-group-id="ungrouped"])'
  )
  await dragWithPointer(
    orcaPage,
    reviewGroup.getByRole('button', { name: 'Drag group Review' }),
    createdGroup
  )
  await expect(namedGroups.first()).toHaveAttribute('data-terminal-manager-group-id', reviewGroupId)
  await dragWithPointer(
    orcaPage,
    reviewGroup.getByRole('button', { name: 'Drag group Review' }),
    manager.locator('[data-terminal-manager-group-end-drop="true"]')
  )
  await expect(namedGroups.nth(1)).toHaveAttribute('data-terminal-manager-group-id', reviewGroupId)

  const firstSession = manager.locator(`[data-terminal-manager-session-id="${seeded.firstTabId}"]`)
  const secondSession = manager.locator(
    `[data-terminal-manager-session-id="${seeded.secondTabId}"]`
  )
  await firstSession.getByRole('button', { name: 'Codex implementation', exact: true }).click()
  await secondSession
    .getByRole('button', { name: 'Tests', exact: true })
    .click({ modifiers: ['Control'] })
  await expect(manager.locator('[data-terminal-manager-selection-count="2"]')).toBeVisible()
  await dragWithPointer(
    orcaPage,
    firstSession.locator('[data-terminal-manager-session-drag-handle="true"]'),
    createdGroup
  )
  await expect(
    createdGroup.locator(`[data-terminal-manager-session-id="${seeded.firstTabId}"]`)
  ).toBeVisible()
  await expect(
    createdGroup.locator(`[data-terminal-manager-session-id="${seeded.secondTabId}"]`)
  ).toBeVisible()

  await manager.getByRole('button', { name: 'Clear selection' }).click()
  await createdGroup
    .getByRole('button', { name: /^Core work/ })
    .first()
    .click()
  await expect(createdGroup.getByRole('button', { name: /^Core work/ }).first()).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  const thirdBeforeMove = manager.locator(
    `[data-terminal-manager-session-id="${seeded.thirdTabId}"]`
  )
  await thirdBeforeMove.getByRole('button', { name: 'Server logs', exact: true }).click()
  await dragWithPointer(
    orcaPage,
    thirdBeforeMove.locator('[data-terminal-manager-session-drag-handle="true"]'),
    createdGroup
  )
  await createdGroup
    .getByRole('button', { name: /^Core work/ })
    .first()
    .click()
  await expect(
    createdGroup.locator(`[data-terminal-manager-session-id="${seeded.thirdTabId}"]`)
  ).toBeVisible()

  await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarTab('explorer'))
  await expect(manager).toHaveCount(0)
  await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarTab('terminal-manager'))
  const restoredManager = orcaPage.locator(
    `[data-terminal-manager-workspace="${seeded.worktreeId}"]`
  )
  const restoredGroup = restoredManager.locator(
    `[data-terminal-manager-group-id="${implementationGroupId}"]`
  )
  await expect(restoredGroup.getByText('Codex implementation', { exact: true })).toBeVisible()
  await expect(restoredGroup.getByText('Tests', { exact: true })).toBeVisible()
  await expect(restoredGroup.getByText('Server logs', { exact: true })).toBeVisible()

  const thirdSession = restoredManager.locator(
    `[data-terminal-manager-session-id="${seeded.thirdTabId}"]`
  )
  await thirdSession.getByRole('button', { name: 'Server logs', exact: true }).click()
  await expect(thirdSession).toHaveAttribute('data-current', 'true')
  await expect(orcaPage.locator('[data-terminal-session-location="true"]')).toContainText(
    'Server logs'
  )
})
