import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { worktreeRow } from './worktree-row-locators'

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
    initial.setSidebarOpen(true)
    initial.setGroupBy('none')
    initial.setShowActiveOnly(false)
    initial.setShowSleepingWorkspaces(true)
    const repo = initial.repos[0]
    const worktree = repo ? initial.worktreesByRepo[repo.id]?.[0] : null
    if (!worktree) {
      throw new Error('Terminal session sidebar test needs a seeded worktree')
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
    state.revealWorktreeInSidebar(worktree.id, { behavior: 'auto' })
    return {
      worktreeId: worktree.id,
      firstTabId: first.id,
      secondTabId: second.id,
      thirdTabId: third.id
    }
  })
}

test('groups terminal sessions under their project and removes terminal chips from the top strip', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const seeded = await seedProjectTerminalSessions(orcaPage)
  const project = worktreeRow(orcaPage, seeded.worktreeId)
  const sessions = project.locator('[data-terminal-session-id]')

  await expect(project.getByText('Terminal sessions', { exact: true })).toBeVisible()
  await expect(sessions).toHaveCount(3)
  await expect(project.getByText('Codex implementation', { exact: true })).toBeVisible()
  await expect(project.getByText('Tests', { exact: true })).toBeVisible()
  await expect(project.getByText('Server logs', { exact: true })).toBeVisible()
  await expect(
    orcaPage.locator(`[data-testid="sortable-tab"][data-tab-id="${seeded.firstTabId}"]`)
  ).toHaveCount(0)
  await expect(orcaPage.locator('[data-terminal-session-location="true"]')).toContainText(
    'Codex implementation'
  )

  const secondSession = project.locator(`[data-terminal-session-id="${seeded.secondTabId}"]`)
  await secondSession.getByRole('button', { name: 'Tests', exact: true }).click()
  await expect(secondSession).toHaveAttribute('data-current', 'true')
  await expect(orcaPage.locator('[data-terminal-session-location="true"]')).toContainText('Tests')

  await project.getByRole('button', { name: /Terminal sessions/ }).click()
  await expect(sessions).toHaveCount(0)
  await project.getByRole('button', { name: /Terminal sessions/ }).click()
  await expect(project.locator('[data-terminal-session-id]')).toHaveCount(3)
})
