import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
const releaseId = 'test-maintenance-release'
const shownKey = `devcare:update-complete:${releaseId}`

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

test('completion is shown after maintenance and never replays after reload', async ({ page }) => {
  let mode = 'maintenance'
  await page.route('**/maintenance.json', (route) =>
    route.fulfill({
      json: {
        mode,
        release_id: releaseId,
        title: 'Scheduled update',
        message: 'Updating DevCare.',
      },
    }),
  )
  await page.goto('/login')
  const completion = page.getByRole('complementary', { name: 'Update complete', exact: true })
  await expect(completion).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), shownKey)).toBeNull()
  mode = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(completion).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), shownKey)).toBe(releaseId)
  // Reload while the notice is still visible, before dismissal or its timeout.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(completion).toHaveCount(0)
  mode = 'maintenance'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Scheduled update' })).toBeVisible()
  mode = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(completion).toHaveCount(0)
})

test('ordinary visits, announcements and unavailable checks do not celebrate an update', async ({
  page,
}) => {
  let mode = 'off'
  let unavailable = false
  await page.route('**/maintenance.json', (route) =>
    unavailable
      ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.fulfill({
          json: {
            mode,
            release_id: releaseId,
            title: 'Scheduled update',
            message: 'Updating DevCare.',
          },
        }),
  )
  const completion = page.getByRole('complementary', { name: 'Update complete', exact: true })
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(completion).toHaveCount(0)
  mode = 'announcement'
  await page.reload()
  await expect(page.getByRole('status', { name: 'Maintenance announcement' })).toBeVisible()
  await expect(completion).toHaveCount(0)
  mode = 'off'
  unavailable = true
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'DevCare is temporarily unavailable.' }),
  ).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(completion).toHaveCount(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), shownKey)).toBeNull()
})

test('a new release can complete once while an older bundle cannot claim a future release', async ({
  page,
}) => {
  let mode = 'maintenance'
  let target = releaseId
  await page.addInitScript(() =>
    localStorage.setItem('devcare:update-complete:old-release', 'old-release'),
  )
  await page.route('**/maintenance.json', (route) =>
    route.fulfill({
      json: { mode, release_id: target, title: 'Scheduled update', message: 'Updating DevCare.' },
    }),
  )
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Scheduled update' })).toBeVisible()
  mode = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(
    page.getByRole('complementary', { name: 'Update complete', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss update complete message' }).click()
  target = 'future-release'
  mode = 'maintenance'
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Scheduled update' })).toBeVisible()
  mode = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Update complete', exact: true }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(() => localStorage.getItem('devcare:update-complete:future-release')),
  ).toBeNull()
})

test('blocked completion storage safely skips the notice and leaves navigation available', async ({
  page,
}) => {
  let mode = 'maintenance'
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('devcare:update-'))
        throw new DOMException('Storage blocked', 'SecurityError')
      return write.call(this, key, value)
    }
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/maintenance.json', (route) =>
    route.fulfill({
      json: {
        mode,
        release_id: releaseId,
        title: 'Scheduled update',
        message: 'Updating DevCare.',
      },
    }),
  )
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Scheduled update' })).toBeVisible()
  mode = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Update complete', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page).toHaveURL('/forgot-password')
  expect(errors).toEqual([])
})

test('repeated React renders do not restart the animation or duplicate the notice', async ({
  page,
}) => {
  let mode = 'maintenance'
  let message = 'Updating DevCare.'
  await page.clock.install()
  await page.addInitScript(() => {
    const state = window as Window & { completionStarts: number }
    state.completionStarts = 0
    document.addEventListener('animationstart', (event) => {
      if (event.target instanceof HTMLElement && event.target.classList.contains('update-complete'))
        state.completionStarts++
    })
  })
  await page.route('**/maintenance.json', (route) =>
    route.fulfill({ json: { mode, release_id: releaseId, title: 'Scheduled update', message } }),
  )
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Scheduled update' })).toBeVisible()
  mode = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  const completion = page.getByRole('complementary', { name: 'Update complete', exact: true })
  await expect(completion).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { completionStarts: number }).completionStarts),
    )
    .toBe(1)
  // Retain the focused control during timeout, then change fetched data to
  // rerender the gate and its children several times without remounting them.
  await page.getByRole('button', { name: 'Dismiss update complete message' }).focus()
  for (let count = 0; count < 3; count++) {
    message = `Update available ${count}`
    await page.clock.fastForward(60000)
    await expect(completion).toHaveCount(1)
  }
  expect(
    await page.evaluate(() => (window as Window & { completionStarts: number }).completionStarts),
  ).toBe(1)
  await page.getByRole('button', { name: 'Dismiss update complete message' }).click()
  await expect(completion).toHaveCount(0)
  await page.clock.fastForward(60000)
  await expect(completion).toHaveCount(0)
})

test('reduced motion shows an accessible static message and expires without blocking navigation', async ({
  page,
}) => {
  let mode = 'maintenance'
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await page.route('**/maintenance.json', (route) =>
    route.fulfill({
      json: {
        mode,
        release_id: releaseId,
        title: 'Scheduled update',
        message: 'Updating DevCare.',
      },
    }),
  )
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Scheduled update' })).toBeVisible()
  mode = 'off'
  await page.getByRole('button', { name: 'Check again' }).click()
  const completion = page.getByRole('complementary', { name: 'Update complete', exact: true })
  await expect(completion).toBeVisible()
  await expect(completion.getByRole('status')).toHaveText(
    'Update completeDevCare is ready. You can continue working.',
  )
  expect(await completion.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'none',
  )
  expect(
    await completion
      .locator('.update-complete-icon')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none')
  expect(
    await page.evaluate(() =>
      document.querySelector('.update-complete')?.contains(document.activeElement),
    ),
  ).toBe(false)
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.clock.fastForward(10000)
  await expect(completion).toHaveCount(0)
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page).toHaveURL('/forgot-password')
})
