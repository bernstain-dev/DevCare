import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('enabled maintenance covers every route without starting Supabase', async ({ page }) => {
  const backendRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('.supabase.co'))
      backendRequests.push(request.url())
  })
  await page.route('https://*.supabase.co/**', (route) => route.abort())
  // An existing expired session must not trigger token refresh while maintenance is active.
  await page.addInitScript(() => {
    localStorage.setItem(
      'sb-devcare-test-auth-token',
      JSON.stringify({ access_token: 'expired', refresh_token: 'test-refresh', expires_at: 1 }),
    )
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const path of [
    '/',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/accept-invitation',
    '/projects/example',
    '/tickets/new',
    '/tickets/example',
    '/clients',
    '/notifications',
    '/settings',
    '/unknown',
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: "We're updating DevCare." })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toHaveCount(0)
    await expect(page).toHaveTitle('Maintenance | DevCare — Client Support Portal')
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: "We're updating DevCare." })).toBeVisible()
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled()
  expect(backendRequests).toEqual([])
  expect(errors).toEqual([])
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(accessibility.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: `.verification/maintenance-${test.info().project.name}.png`,
    fullPage: true,
  })
})

test('announcement allows sign-in and maintenance can be lifted without losing the route', async ({
  page,
}) => {
  let mode = 'announcement'
  await page.route('**/maintenance.json', (route) =>
    route.fulfill({
      json: { mode, title: 'Scheduled update', message: 'An update is on the way.' },
    }),
  )
  await page.clock.install()
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Maintenance announcement' })).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  mode = 'maintenance'
  await page.clock.fastForward(60000)
  await expect(page.getByRole('heading', { name: 'Scheduled update' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toHaveCount(0)
  mode = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('status', { name: 'Maintenance announcement' })).toHaveCount(0)
})

test('failed or malformed status stays unavailable and manual retry restores access', async ({
  page,
}) => {
  let response: 'failed' | 'invalid' | 'off' = 'failed'
  await page.route('**/maintenance.json', (route) =>
    response === 'failed'
      ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.fulfill({
          json:
            response === 'invalid'
              ? { mode: 'unexpected' }
              : { mode: 'off', title: 'Update', message: 'Update complete.' },
        }),
  )
  await page.goto('/login')
  await expect(
    page.getByRole('heading', { name: 'DevCare is temporarily unavailable.' }),
  ).toBeVisible()
  response = 'invalid'
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toHaveCount(0)
  response = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
})
