import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminConfig, bootstrapAdmin, recoverAdminPassword } from './admin-setup.mjs'
import { hiddenPassword } from './operator-prompt.mjs'
import { PassThrough } from 'node:stream'

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_operator',
  DEVCARE_ADMIN_EMAIL: 'Developer@devcare.test',
  DEVCARE_SITE_URL: 'http://127.0.0.1:5173',
}
test('accepts loopback origins and normalizes the configured email', () => {
  assert.equal(adminConfig(env).siteUrl, 'http://127.0.0.1:5173')
  assert.equal(adminConfig(env).email, 'developer@devcare.test')
  assert.equal(
    adminConfig({ ...env, DEVCARE_SITE_URL: 'http://localhost:5173/' }).siteUrl,
    'http://localhost:5173',
  )
})
test('rejects malformed invitation destinations before making requests', () => {
  for (const url of [
    'http://127.0.0.1:5173/login',
    'https://portal.test?token=secret',
    'http://portal.test',
    'https://user:secret@portal.test',
  ])
    assert.throws(() => adminConfig({ ...env, DEVCARE_SITE_URL: url }), /DEVCARE_SITE_URL/)
  assert.throws(
    () => adminConfig({ ...env, SUPABASE_URL: 'https://supabase.com/dashboard/project/id' }),
    /project API origin/,
  )
})
test('rejects frontend keys without disclosing the value', () => {
  for (const key of ['sb_publishable_sensitive_value', 'invalid_sensitive_value']) {
    assert.throws(
      () => adminConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: key }),
      (error) => error.message.includes('server secret') && !error.message.includes(key),
    )
  }
})
function existingAdmin(rows) {
  // No mutation/Auth methods: any accidental invitation or update will fail this test.
  return {
    from: () => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: rows, error: null }) }) }),
    }),
  }
}
test('rerunning setup for the active admin is read-only and sends no email', async () => {
  const message = await bootstrapAdmin(
    existingAdmin([{ email: 'Developer@devcare.test', active: true }]),
    adminConfig(env),
  )
  assert.match(message, /already exists and is active/)
  assert.match(message, /No invitation was sent/)
})
test('refuses to create another admin or reactivate a disabled admin', async () => {
  for (const row of [
    { email: 'another@devcare.test', active: true },
    { email: 'developer@devcare.test', active: false },
  ])
    await assert.rejects(
      bootstrapAdmin(existingAdmin([row]), adminConfig(env)),
      /No accounts were changed/,
    )
})
test('failed backend lookups report only safe error codes', async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: async () => ({
            data: null,
            error: { code: '42501', message: 'sensitive server response' },
          }),
        }),
      }),
    }),
  }
  await assert.rejects(
    bootstrapAdmin(client, adminConfig(env)),
    (error) =>
      error.message.includes('42501') && !error.message.includes('sensitive server response'),
  )
})

function setupClient(profile, promotion) {
  const responses = [{ data: [], error: null }, { data: profile, error: null }, promotion]
  const invites = []
  const client = {
    from() {
      const query = {}
      for (const method of ['select', 'eq', 'update']) query[method] = () => query
      for (const method of ['limit', 'maybeSingle', 'single'])
        query[method] = async () => responses.shift()
      return query
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email_confirmed_at: '2026-10-08' } },
          error: null,
        }),
        inviteUserByEmail: async (email, options) => {
          invites.push({ email, options })
          return { data: { user: { id: 'new-user' } }, error: null }
        },
      },
    },
  }
  return { client, invites }
}
test('new admin invitations use the exact acceptance callback', async () => {
  const { client, invites } = setupClient(null, { data: { id: 'new-user' }, error: null })
  assert.match(await bootstrapAdmin(client, adminConfig(env)), /First admin created/)
  assert.equal(invites.length, 1)
  assert.equal(invites[0].options.redirectTo, 'http://127.0.0.1:5173/accept-invitation')
})
test('confirmed accounts are promoted without sending another invitation', async () => {
  const { client, invites } = setupClient(
    { id: 'existing-user' },
    { data: { id: 'existing-user' }, error: null },
  )
  assert.match(await bootstrapAdmin(client, adminConfig(env)), /First admin created/)
  assert.equal(invites.length, 0)
})
test('missing profiles cannot produce a false successful promotion', async () => {
  const { client } = setupClient(null, { data: null, error: { code: 'PGRST116' } })
  await assert.rejects(bootstrapAdmin(client, adminConfig(env)), /Admin promotion failed/)
})

const recoveryEmail = 'developer@devcare.test'
const recoveryProfile = { id: 'existing-admin', email: recoveryEmail, role: 'admin', active: true }
const recoveryUser = {
  id: 'existing-admin',
  email: recoveryEmail,
  email_confirmed_at: '2026-10-08',
}
const passwordInput = { password: 'unique test passphrase', confirm: 'unique test passphrase' }
function recoveryClient(profile = recoveryProfile, user = recoveryUser, updateError = null) {
  const updates = []
  return {
    updates,
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }),
        }),
      }),
      auth: {
        admin: {
          getUserById: async () => ({ data: { user }, error: null }),
          updateUserById: async (id, attributes) => {
            updates.push({ id, attributes })
            return { data: { user: updateError ? null : user }, error: updateError }
          },
        },
      },
    },
  }
}
test('operator recovery updates only the verified active admin password without an email operation', async () => {
  const { client, updates } = recoveryClient()
  assert.match(
    await recoverAdminPassword(client, recoveryEmail, async () => passwordInput),
    /Admin password updated/,
  )
  assert.deepEqual(updates, [
    { id: recoveryUser.id, attributes: { password: passwordInput.password } },
  ])
})
test('recovery refuses missing, non-admin and inactive profiles before requesting a password', async () => {
  for (const profile of [
    null,
    { ...recoveryProfile, role: 'client' },
    { ...recoveryProfile, active: false },
  ]) {
    const { client, updates } = recoveryClient(profile)
    await assert.rejects(
      recoverAdminPassword(client, recoveryEmail, () =>
        assert.fail('Password must not be requested'),
      ),
      /existing active admin/,
    )
    assert.equal(updates.length, 0)
  }
})
test('recovery refuses mismatched or unconfirmed Auth identities', async () => {
  for (const user of [
    null,
    { ...recoveryUser, id: 'different' },
    { ...recoveryUser, email: 'another@devcare.test' },
    { ...recoveryUser, email_confirmed_at: null },
  ]) {
    const { client, updates } = recoveryClient(recoveryProfile, user)
    await assert.rejects(
      recoverAdminPassword(client, recoveryEmail, () =>
        assert.fail('Password must not be requested'),
      ),
      /matching Auth user/,
    )
    assert.equal(updates.length, 0)
  }
})
test('recovery rejects short and mismatched passwords without submitting them', async () => {
  for (const input of [
    { password: 'short', confirm: 'short' },
    { ...passwordInput, confirm: 'different test passphrase' },
  ]) {
    const { client, updates } = recoveryClient()
    await assert.rejects(
      recoverAdminPassword(client, recoveryEmail, async () => input),
      /No accounts were changed/,
    )
    assert.equal(updates.length, 0)
  }
})
test('recovery API failures do not disclose passwords or response bodies', async () => {
  const { client } = recoveryClient(recoveryProfile, recoveryUser, {
    code: 'weak_password',
    message: passwordInput.password,
  })
  await assert.rejects(
    recoverAdminPassword(client, recoveryEmail, async () => passwordInput),
    (error) =>
      error.message.includes('weak_password') && !error.message.includes(passwordInput.password),
  )
})
test('hidden prompts refuse piped input', async () => {
  await assert.rejects(
    hiddenPassword('Password: ', new PassThrough(), new PassThrough()),
    /interactive terminal/,
  )
})
function promptStreams() {
  const input = new PassThrough()
  input.isTTY = true
  input.isRaw = false
  input.setRawMode = (raw) => {
    input.isRaw = raw
  }
  const output = new PassThrough()
  output.isTTY = true
  let printed = ''
  output.on('data', (value) => {
    printed += value.toString()
  })
  return { input, output, printed: () => printed }
}
test('hidden prompts never echo entered passwords and restore terminal state', async () => {
  const { input, output, printed } = promptStreams()
  const result = hiddenPassword('Password: ', input, output)
  input.emit('keypress', passwordInput.password, {})
  input.emit('keypress', '\r', { name: 'return' })
  assert.equal(await result, passwordInput.password)
  assert.equal(printed(), 'Password: \n')
  assert.equal(input.isRaw, false)
  assert.equal(input.listenerCount('keypress'), 0)
  assert.equal(input.isPaused(), true)
})
test('cancelling a hidden prompt restores the terminal and does not submit a password', async () => {
  const { input, output, printed } = promptStreams()
  const result = hiddenPassword('Password: ', input, output)
  input.emit('keypress', passwordInput.password, {})
  input.emit('keypress', '\u0003', { name: 'c', ctrl: true })
  await assert.rejects(result, /Recovery cancelled/)
  assert.equal(input.isRaw, false)
  assert.equal(printed(), 'Password: \n')
})
