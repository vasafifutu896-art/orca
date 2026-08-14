import { expect, test } from './helpers/orca-app'

test('shows the SSH server launcher in the left sidebar', async ({ orcaPage }) => {
  const servers = orcaPage.getByRole('region', { name: 'Servers' })

  await expect(servers).toBeVisible()
  await expect(servers.getByText('Double-click a server to open a terminal')).toBeVisible()
  await servers.getByRole('button', { name: 'Add your first SSH server' }).click()
  await expect(orcaPage.getByRole('heading', { name: 'Add SSH host' })).toBeVisible()
})
