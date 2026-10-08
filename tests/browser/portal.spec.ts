// Explicit API contract fixtures for browser UI tests. They are never shipped
// in the application and do not claim hosted Supabase/SMTP verification.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
const adminId = '11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
const accountId = '33333333-3333-4333-8333-333333333333'
const projectId = '44444444-4444-4444-8444-444444444444'
const ticketId = '55555555-5555-4555-8555-555555555555'
const now = '2026-10-08T08:00:00Z'
async function portal(page: Page, role: 'admin' | 'client' = 'client', signedIn = true) {
  const id = role === 'admin' ? adminId : clientId
  const user = {
    id,
    email: `${role}@example.test`,
    aud: 'authenticated',
    role: 'authenticated',
    created_at: now,
    app_metadata: { provider: 'email' },
    user_metadata: {},
  }
  const profile = {
    ...user,
    display_name: role === 'admin' ? 'Developer' : 'Client User',
    role,
    active: true,
  }
  const payload = Buffer.from(
    JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' }),
  ).toString('base64url')
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`,
    refresh_token: 'test-refresh',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  }
  const project = {
    id: projectId,
    client_id: accountId,
    name: 'Client Portal',
    description: 'A real project interface contract',
    current_version: '1.2',
    application_url: 'https://example.test',
    support_notes: 'Contact support through this portal.',
    archived: false,
    created_at: now,
    clients: { name: 'Client Business' },
  }
  const client = {
    id: accountId,
    name: 'Client Business',
    contact_email: 'contact@example.test',
    description: 'Client business account',
    active: true,
    created_at: now,
  }
  const ticket = {
    id: ticketId,
    reference: 'DC-000001',
    project_id: projectId,
    client_id: accountId,
    created_by: clientId,
    author_name: 'Client User',
    title: 'Cannot save profile',
    description: 'Saving the profile displays an error.',
    request_type: 'Bug Report',
    priority: 'Normal',
    requested_urgency: 'High',
    status: 'Open',
    resolution_summary: null as string | null,
    created_at: now,
    updated_at: now,
    steps_to_reproduce: 'Open profile and save',
    expected_behavior: 'Profile saves',
    actual_behavior: 'An error appears',
    affected_version: '1.2',
    device_browser: 'Chrome',
    projects: { name: project.name },
  }
  const messages: Record<string, unknown>[] = []
  const events: Record<string, unknown>[] = [
    {
      id: 'event1',
      ticket_id: ticketId,
      actor_name: 'Client User',
      kind: 'created',
      detail: {},
      created_at: now,
      tickets: { reference: ticket.reference, title: ticket.title },
    },
  ]
  let fileAttempts = 0
  if (signedIn)
    await page.addInitScript(
      ({ session }) => localStorage.setItem('sb-devcare-test-auth-token', JSON.stringify(session)),
      { session },
    )
  await page.route('https://devcare-test.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({
        status,
        json: body,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'content-range',
          ...headers,
        },
      })
    if (request.method() === 'OPTIONS')
      return reply({}, 200, {
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
      })
    if (path.startsWith('/auth/v1/')) {
      if (path.endsWith('/logout')) return reply({})
      if (path.endsWith('/recover')) return reply({})
      if (path.endsWith('/user')) return reply(user)
      return reply(session)
    }
    if (path === '/functions/v1/admin-users')
      return reply({ message: 'Invitation sent and membership assigned.' })
    if (path === '/functions/v1/files') {
      fileAttempts++
      if (fileAttempts === 1)
        return reply(
          { error: 'Storage upload failed. Your report or reply is saved; retry the attachment.' },
          502,
        )
      return reply({ id: 'attachment' })
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const body = request.postDataJSON()
      const name = path.split('/').pop()
      if (name === 'is_admin') return reply(role === 'admin')
      if (name === 'is_active_user') return reply(true)
      if (name === 'create_ticket') {
        Object.assign(ticket, {
          title: body.p_title,
          description: body.p_description,
          request_type: body.p_type,
        })
        return reply(ticket)
      }
      if (name === 'change_ticket_status') {
        const from = ticket.status
        ticket.status = body.p_status
        if (body.p_status === 'Resolved') ticket.resolution_summary = body.p_reason
        events.unshift({
          id: `event${events.length + 1}`,
          ticket_id: ticketId,
          actor_name: profile.display_name,
          kind: 'status_changed',
          detail: { from, to: body.p_status, reason: body.p_reason },
          created_at: now,
        })
        return reply(null)
      }
      if (name === 'send_reply') {
        const message = {
          id: 'message1',
          ticket_id: ticketId,
          author_id: id,
          author_name: profile.display_name,
          body: body.p_body,
          created_at: now,
          attachments: [],
        }
        messages.push(message)
        return reply(message)
      }
      return reply(null)
    }
    const table = path.split('/').pop()
    let rows: Record<string, unknown>[] = []
    if (table === 'profiles') rows = [profile]
    if (table === 'clients') rows = [client]
    if (table === 'client_memberships') rows = []
    if (table === 'projects') rows = [project]
    if (table === 'tickets') rows = [ticket]
    if (table === 'ticket_messages') rows = messages
    if (table === 'ticket_events') rows = events
    if (table === 'notifications') rows = []
    if (table === 'attachments' || table === 'internal_notes') rows = []
    const filter = url.searchParams.get('status')
    if (filter) rows = rows.filter((r) => `eq.${r.status}` === filter)
    if (request.method() === 'HEAD')
      return route.fulfill({
        status: 200,
        body: '',
        headers: {
          'content-range': `0-0/${rows.length}`,
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'content-range',
        },
      })
    const single = request.headers().accept?.includes('vnd.pgrst.object+json')
    return reply(single ? (rows[0] ?? {}) : rows, 200, {
      'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
    })
  })
  return { ticket }
}
test('login, recovery and invitation screens validate input', async ({ page }) => {
  await portal(page, 'client', false)
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(accessibility.violations).toEqual([])
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await expect(page.getByText('Enter your password.')).toBeVisible()
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email address').fill('client@example.test')
  await page.getByRole('button', { name: 'Send Reset Link' }).click()
  await expect(page.getByRole('status')).toContainText('reset email')
  await page.goto('/accept-invitation')
  await expect(page.getByText('Open the secure link in your email')).toBeVisible()
  await page.goto('/reset-password')
  await expect(page.getByRole('link', { name: 'Request another reset link.' })).toBeVisible()
})
test('client can navigate, submit and recover from a failed attachment upload', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await portal(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hello, Client.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Clients', exact: true })).toHaveCount(0)
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('*')]
      .filter((el) => {
        const box = el.getBoundingClientRect()
        return box.right > document.documentElement.clientWidth + 1 && box.left >= 0
      })
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        right: el.getBoundingClientRect().right,
      }))
      .slice(0, 20),
  }))
  expect(layout.documentWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width)
  await page.screenshot({
    path: `.verification/${test.info().project.name}-dashboard.png`,
    fullPage: true,
  })
  await page
    .locator('.page-title')
    .getByRole('link', { name: 'Submit Ticket', exact: true })
    .click()
  await page.getByLabel('Assigned project *').selectOption(projectId)
  await page.getByLabel('Request type *').selectOption('Feature Request')
  await expect(page.getByText('Submitting a feature request does not approve')).toBeVisible()
  await page.getByLabel('Title *', { exact: true }).fill('Add an export option')
  await page
    .getByLabel('Description *', { exact: true })
    .fill('Please add a PDF export option for reports.')
  await page.getByLabel('Supporting attachments').setInputFiles({
    name: 'report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 sample'),
  })
  await page.getByRole('button', { name: 'Submit Ticket', exact: true }).click()
  await expect(page.getByText('was saved. Your ticket will not be submitted twice.')).toBeVisible()
  await page.getByRole('button', { name: 'Retry Failed Attachments' }).click()
  await expect(page).toHaveURL(new RegExp(`/tickets/${ticketId}`))
  await expect(
    page.getByRole('heading', { name: 'Add an export option', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Your reply').fill('Thank you for reviewing the request.')
  await page.getByRole('button', { name: 'Send Reply' }).click()
  await expect(
    page.getByText('Thank you for reviewing the request.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Internal notes' })).toHaveCount(0)
  expect(requests.some((r) => r.includes('/internal_notes'))).toBe(false)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Add an export option', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
  if (test.info().project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('link', { name: 'My Projects', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'My Projects', exact: true })).toBeVisible()
  }
})
test('admin resolves, reopens and manages accounts', async ({ page }) => {
  await portal(page, 'admin')
  await page.goto(`/tickets/${ticketId}`)
  await page.getByRole('button', { name: 'Resolve Ticket', exact: true }).click()
  await page.getByLabel('Resolution summary *').fill('Fixed the save validation.')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Resolve Ticket', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Latest resolution summary' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm Resolution', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm Resolution', exact: true })
    .click()
  await expect(page.getByText('This ticket is closed.')).toBeVisible()
  await page.getByRole('button', { name: 'Reopen Ticket', exact: true }).click()
  await page.getByLabel('Reason for reopening *').fill('Need to check another case.')
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen Ticket', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Set In Progress' })).toBeVisible()
  await page.goto('/clients')
  await page.getByRole('button', { name: 'Add Client', exact: true }).click()
  await page.getByLabel('Client / business name').fill('New account')
  await page.getByRole('dialog').getByRole('button', { name: 'Add Client', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Manage Users' }).click()
  await page.getByLabel('Full name').fill('Invited Client')
  await page.getByLabel('Email address').fill('invited@example.test')
  await page.getByRole('button', { name: 'Invite User' }).click()
  await expect(page.getByText('Invitation sent and membership assigned.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/projects')
  await page.getByRole('button', { name: 'Add Project', exact: true }).click()
  await page.getByLabel('Project name').fill('New project')
  await page.getByLabel('Client account').selectOption(accountId)
  await page.getByRole('dialog').getByRole('button', { name: 'Add Project', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('client confirms a resolution and can reopen a resolved ticket', async ({ page }) => {
  const { ticket } = await portal(page)
  ticket.status = 'Resolved'
  ticket.resolution_summary = 'The issue has been fixed.'
  await page.goto(`/tickets/${ticketId}`)
  await page.getByRole('button', { name: 'Reopen Ticket', exact: true }).click()
  await page.getByLabel('Reason for reopening *').fill('The error persists on mobile.')
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen Ticket', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reopen Ticket', exact: true })).toHaveCount(0)
  ticket.status = 'Resolved'
  await page.reload()
  await page.getByRole('button', { name: 'Confirm Resolution', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm Resolution', exact: true })
    .click()
  await expect(page.getByLabel('Your reply')).toHaveCount(0)
})
test('dashboard and ticket page meet automated WCAG A/AA checks', async ({ page }) => {
  await portal(page)
  for (const path of ['/', `/tickets/${ticketId}`]) {
    await page.goto(path)
    await expect(
      page.getByRole('heading', { name: path === '/' ? 'Recent tickets' : 'Original report' }),
    ).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ).toEqual([])
  }
})
