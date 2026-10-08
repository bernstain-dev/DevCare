// Real Supabase Auth, PostgREST, Edge Functions and Storage tests.
// Requires an explicitly disposable project. Created history is intentionally
// preserved; destroy the whole disposable project after verification.
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const {
  SUPABASE_URL: URL,
  SUPABASE_PUBLISHABLE_KEY: KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
} = process.env
if (process.env.DEVCARE_TEST_ALLOW_RESET !== 'YES_DISPOSABLE_PROJECT' || !URL || !KEY || !SERVICE)
  throw new Error(
    'Configure .env.test for a disposable Supabase project. Never run against production.',
  )
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}
const elevated = createClient(URL, SERVICE, options)
const client = () => createClient(URL, KEY, options)
const password = randomBytes(24).toString('base64url')
const emailDomain = process.env.DEVCARE_TEST_EMAIL_DOMAIN ?? 'example.test'
if (!['localhost', '127.0.0.1'].includes(new URL(URL).hostname) && emailDomain.endsWith('.test'))
  throw new Error(
    'Hosted recovery tests require DEVCARE_TEST_EMAIL_DOMAIN set to a test mail domain/catch-all you control.',
  )
const tag = Date.now()
let checks = 0
function good(result, label) {
  assert.equal(result.error, null, label)
  checks++
  return result.data
}
function denied(result, label) {
  assert.ok(result.error, label)
  checks++
}
async function makeUser(name) {
  const email = `devcare-${name}-${tag}@${emailDomain}`
  const result = await elevated.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name, role: 'admin' },
  })
  return good(result, `Create ${name}`).user
}
const adminUser = await makeUser('admin'),
  aUser = await makeUser('a'),
  bUser = await makeUser('b')
good(
  await elevated.from('profiles').update({ role: 'admin' }).eq('id', adminUser.id),
  'Bootstrap disposable admin',
)
const admin = client(),
  a = client(),
  b = client()
for (const [connection, user] of [
  [admin, adminUser],
  [a, aUser],
  [b, bUser],
])
  good(await connection.auth.signInWithPassword({ email: user.email, password }), 'Real Auth login')
assert.equal(
  good(await a.from('profiles').select('role').eq('id', aUser.id).single(), 'Read own role').role,
  'client',
)
checks++
const ca = good(
  await admin.rpc('save_client', {
    p_id: null,
    p_name: `A ${tag}`,
    p_email: '',
    p_description: 'Integration test',
    p_active: true,
  }),
  'Create account A',
)
const cb = good(
  await admin.rpc('save_client', {
    p_id: null,
    p_name: `B ${tag}`,
    p_email: '',
    p_description: 'Integration test',
    p_active: true,
  }),
  'Create account B',
)
for (const [account, user] of [
  [ca, aUser],
  [cb, bUser],
])
  good(
    await admin.rpc('set_membership', { p_client: account, p_user: user.id, p_active: true }),
    'Assign client',
  )
async function project(account) {
  return good(
    await admin.rpc('save_project', {
      p_id: null,
      p_client: account,
      p_name: `Project ${randomUUID()}`,
      p_description: 'Test',
      p_url: '',
      p_version: '1.0',
      p_notes: '',
      p_archived: false,
    }),
    'Create project',
  )
}
const pa = await project(ca),
  pb = await project(cb)
const args = (p) => ({
  p_project: p,
  p_type: 'Bug Report',
  p_title: 'Integration issue',
  p_description: 'Detailed integration reproduction steps.',
  p_urgency: 'Urgent',
})
const ta = good(await a.rpc('create_ticket', args(pa)), 'Create A ticket')
const tb = good(await b.rpc('create_ticket', args(pb)), 'Create B ticket')
assert.equal(ta.priority, 'Normal')
checks++
assert.equal(
  good(await a.from('tickets').select('*').eq('id', tb.id), 'Cross-account direct GET').length,
  0,
)
checks++
denied(
  await a.from('profiles').update({ role: 'admin' }).eq('id', aUser.id),
  'Direct self promotion denied',
)
denied(
  await a.from('tickets').update({ client_id: cb, project_id: pb }).eq('id', ta.id),
  'Direct ownership mutation denied',
)
denied(
  await a.rpc('send_reply', { p_ticket: tb.id, p_body: 'Cross account' }),
  'Cross-account modified ID denied',
)
denied(
  await a.functions.invoke('admin-users', {
    body: { client_id: ca, email: aUser.email, name: 'Forged admin' },
  }),
  'Privileged Edge rejects client',
)
good(
  await admin.functions.invoke('admin-users', {
    body: { client_id: ca, email: aUser.email, name: 'Existing user' },
  }),
  'Admin Edge assigns existing user',
)
good(
  await admin.rpc('add_internal_note', { p_ticket: ta.id, p_body: 'Private internal details' }),
  'Add internal note',
)
assert.equal(good(await a.from('internal_notes').select('*'), 'Direct private notes GET').length, 0)
checks++
denied(
  await a
    .from('ticket_events')
    .insert({ ticket_id: ta.id, actor_id: adminUser.id, actor_name: 'Fake', kind: 'created' }),
  'Forged audit denied',
)
good(
  await admin.rpc('change_ticket_status', {
    p_ticket: ta.id,
    p_status: 'Waiting for Client',
    p_reason: 'Need details',
  }),
  'Wait for client',
)
good(
  await a.rpc('send_reply', { p_ticket: ta.id, p_body: 'Requested details supplied' }),
  'Client reply',
)
assert.equal(
  good(await a.from('tickets').select('status').eq('id', ta.id).single(), 'Read reply transition')
    .status,
  'In Progress',
)
checks++
denied(
  await admin.rpc('change_ticket_status', { p_ticket: ta.id, p_status: 'Resolved', p_reason: '' }),
  'Empty resolution denied',
)
good(
  await admin.rpc('change_ticket_status', {
    p_ticket: ta.id,
    p_status: 'Resolved',
    p_reason: 'Fixed validation',
  }),
  'Resolve',
)
good(
  await a.rpc('change_ticket_status', {
    p_ticket: ta.id,
    p_status: 'Open',
    p_reason: 'Still happening',
  }),
  'Client reopen',
)
good(
  await admin.rpc('change_ticket_status', {
    p_ticket: ta.id,
    p_status: 'Resolved',
    p_reason: 'Fixed remaining case',
  }),
  'Resolve again',
)
good(
  await a.rpc('change_ticket_status', { p_ticket: ta.id, p_status: 'Closed', p_reason: '' }),
  'Confirm resolution',
)
good(
  await admin.rpc('change_ticket_status', {
    p_ticket: ta.id,
    p_status: 'Open',
    p_reason: 'Check attachment flow',
  }),
  'Admin reopen closed',
)
const concurrent = await Promise.all(
  Array.from({ length: 20 }, () => a.rpc('create_ticket', args(pa))),
)
const references = concurrent.map((r) => good(r, 'Concurrent ticket').reference)
assert.equal(new Set(references).size, 20)
checks++
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3sAAAAASUVORK5CYII=',
  'base64',
)
async function upload(connection, ticket, bytes = png, mime = 'image/png', name = 'test.png') {
  const form = new FormData()
  form.set('ticket_id', ticket)
  form.set('file', new Blob([bytes], { type: mime }), name)
  return connection.functions.invoke('files', { body: form })
}
denied(await upload(b, ta.id), 'Cross-account upload denied')
denied(await upload(a, ta.id, Buffer.from('not a PNG')), 'Forged MIME signature denied')
denied(await upload(a, ta.id, Buffer.alloc(5242881)), 'Oversize upload denied')
const file = good(await upload(a, ta.id), 'Private file upload')
good(await upload(a, ta.id), 'Second attachment')
good(await upload(a, ta.id), 'Third attachment')
denied(await upload(a, ta.id), 'Fourth attachment denied')
denied(
  await b.functions.invoke('files', { body: { action: 'download', attachment_id: file.id } }),
  'Cross-account file download denied',
)
const signed = good(
  await a.functions.invoke('files', { body: { action: 'download', attachment_id: file.id } }),
  'Signed download',
)
const downloaded = await fetch(signed.url)
assert.equal(downloaded.status, 200)
assert.equal((await downloaded.arrayBuffer()).byteLength, png.length)
checks += 2
denied(
  await a.storage
    .from('ticket-attachments')
    .upload('forged-path.png', png, { contentType: 'image/png' }),
  'Direct Storage write denied',
)
denied(await a.functions.invoke('files', { body: { action: 'cleanup' } }), 'Client cleanup denied')
good(
  await admin.functions.invoke('files', { body: { action: 'cleanup' } }),
  'Admin cleanup preserves ready files',
)
// Real Auth invitation verification and password recovery, with generated test
// links. These check Auth tokens; SMTP delivery must be checked separately.
const invitedEmail = `devcare-invited-${tag}@${emailDomain}`
const invite = good(
  await elevated.auth.admin.generateLink({
    type: 'invite',
    email: invitedEmail,
    options: { redirectTo: 'http://localhost:5173/accept-invitation' },
  }),
  'Generate invitation token',
)
const invited = client()
good(
  await invited.auth.verifyOtp({ token_hash: invite.properties.hashed_token, type: 'invite' }),
  'Accept invitation',
)
good(await invited.auth.updateUser({ password }), 'Set invited password')
good(
  await admin.rpc('set_membership', { p_client: ca, p_user: invite.user.id, p_active: true }),
  'Assign invited user',
)
good(await invited.auth.signOut(), 'Invitation logout')
good(await invited.auth.signInWithPassword({ email: invitedEmail, password }), 'Invited user login')
good(
  await invited.auth.resetPasswordForEmail(invitedEmail, {
    redirectTo: 'http://localhost:5173/reset-password',
  }),
  'Request recovery email',
)
const recovery = good(
  await elevated.auth.admin.generateLink({
    type: 'recovery',
    email: invitedEmail,
    options: { redirectTo: 'http://localhost:5173/reset-password' },
  }),
  'Generate recovery test token',
)
good(
  await invited.auth.verifyOtp({ token_hash: recovery.properties.hashed_token, type: 'recovery' }),
  'Verify recovery',
)
const newPassword = randomBytes(24).toString('base64url')
good(await invited.auth.updateUser({ password: newPassword }), 'Update recovered password')
good(await invited.auth.signOut(), 'Recovery logout')
good(
  await invited.auth.signInWithPassword({ email: invitedEmail, password: newPassword }),
  'Recovered login',
)
// Same client instance and JWT are retained while access is disabled.
good(await admin.rpc('set_user_active', { p_user: aUser.id, p_active: false }), 'Disable user')
assert.equal(good(await a.from('tickets').select('*'), 'Disabled existing JWT GET').length, 0)
checks++
denied(
  await a.rpc('send_reply', { p_ticket: ta.id, p_body: 'Disabled reply' }),
  'Disabled JWT write denied',
)
denied(
  await a.functions.invoke('files', { body: { action: 'download', attachment_id: file.id } }),
  'Disabled JWT download denied',
)
good(await admin.rpc('set_user_active', { p_user: aUser.id, p_active: true }), 'Reenable user')
good(
  await admin.rpc('set_membership', { p_client: ca, p_user: aUser.id, p_active: false }),
  'Disable membership',
)
assert.equal(good(await a.from('tickets').select('*'), 'Revoked membership GET').length, 0)
checks++
good(
  await admin.rpc('set_membership', { p_client: ca, p_user: aUser.id, p_active: true }),
  'Restore membership',
)
good(
  await admin.rpc('save_client', {
    p_id: ca,
    p_name: `A ${tag}`,
    p_email: '',
    p_description: 'Test',
    p_active: false,
  }),
  'Disable business',
)
assert.equal(good(await a.from('projects').select('*'), 'Disabled business GET').length, 0)
checks++
console.log(
  `PASS: ${checks} real Supabase integration checks. SMTP inbox delivery, hosted callback navigation and Cloudflare refresh still need release smoke testing.`,
)
console.log(
  'Test history was preserved. Destroy or reset this disposable project; do not reuse it for real clients.',
)
