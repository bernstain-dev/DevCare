export function adminConfig(env) {
  for (const name of [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DEVCARE_ADMIN_EMAIL',
    'DEVCARE_SITE_URL',
  ]) {
    if (!env[name]?.trim() || /YOUR_|example\.com/i.test(env[name]))
      throw new Error(`Set ${name} in .env.admin. See .env.admin.example.`)
  }
  let backend, site
  try {
    backend = new URL(env.SUPABASE_URL)
    site = new URL(env.DEVCARE_SITE_URL)
  } catch {
    throw new Error('SUPABASE_URL and DEVCARE_SITE_URL must be valid URLs.')
  }
  const safeOrigin = (url) =>
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  if (!safeOrigin(backend) || backend.hostname === 'supabase.com')
    throw new Error('SUPABASE_URL must be the project API origin, not a Supabase dashboard URL.')
  if (!safeOrigin(site))
    throw new Error(
      'DEVCARE_SITE_URL must be an HTTPS origin or local development origin, with no /login path, query or fragment.',
    )
  const email = env.DEVCARE_ADMIN_EMAIL.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('DEVCARE_ADMIN_EMAIL must be a valid email address.')
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim()
  let role
  try {
    role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role
  } catch {
    /* New secret keys are opaque, not JWTs. */
  }
  if (!key.startsWith('sb_secret_') && role !== 'service_role')
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY requires a server secret or legacy service_role key, never a publishable/anon key.',
    )
  return { url: backend.origin, key, email, siteUrl: site.origin }
}

function fail(label, error) {
  // Never print API bodies: they may contain email addresses, URLs or tokens.
  const code = /^[a-zA-Z0-9_]+$/.test(error?.code ?? '') ? ` (${error.code})` : ''
  throw new Error(`${label}${code}`)
}

export async function bootstrapAdmin(admin, { email, siteUrl }) {
  const { data: admins, error: lookup } = await admin
    .from('profiles')
    .select('id,email,active')
    .eq('role', 'admin')
    .limit(2)
  if (lookup)
    fail('Profile lookup failed. Apply migrations and verify the project URL/server key.', lookup)
  if (admins.length) {
    if (admins.length === 1 && admins[0].email.toLowerCase() === email && admins[0].active)
      return 'Your admin account already exists and is active. Sign in, or use Forgot password to set a new password. No invitation was sent.'
    throw new Error(
      'An admin already exists. No accounts were changed. Use the trusted operator recovery procedure in DEPLOYMENT.md.',
    )
  }
  const existing = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existing.error) fail('Account lookup failed.', existing.error)
  let id = existing.data?.id
  let needsInvitation = !id
  if (id) {
    const current = await admin.auth.admin.getUserById(id)
    if (current.error) fail('Could not inspect invitation state.', current.error)
    needsInvitation = !current.data.user.email_confirmed_at
  }
  if (needsInvitation) {
    const invite = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/accept-invitation`,
      data: { display_name: 'Developer' },
    })
    if (invite.error || !invite.data.user)
      fail(
        'Admin invitation failed. Check SMTP and exact callbacks. If the Auth user already exists without a profile, use operator recovery in DEPLOYMENT.md.',
        invite.error,
      )
    id = invite.data.user.id
  }
  const promotion = await admin
    .from('profiles')
    .update({ role: 'admin', active: true })
    .eq('id', id)
    .select('id')
    .single()
  if (promotion.error || !promotion.data)
    fail(
      'Admin promotion failed. Confirm the profile trigger/migrations and use operator recovery in DEPLOYMENT.md.',
      promotion.error,
    )
  return 'First admin created. Open the invitation email to set your password, or sign in with your existing account. Remove .env.admin after setup and protect the operator key.'
}

export async function recoverAdminPassword(admin, email, readPassword) {
  const profile = await admin
    .from('profiles')
    .select('id,email,role,active')
    .eq('email', email)
    .maybeSingle()
  if (profile.error) fail('Could not inspect the configured admin profile.', profile.error)
  if (!profile.data || profile.data.role !== 'admin' || !profile.data.active)
    throw new Error(
      'Recovery requires an existing active admin matching DEVCARE_ADMIN_EMAIL. No accounts were changed.',
    )
  const current = await admin.auth.admin.getUserById(profile.data.id)
  if (current.error) fail('Could not verify the configured Auth user.', current.error)
  const user = current.data?.user
  if (
    !user ||
    user.id !== profile.data.id ||
    user.email?.toLowerCase() !== email ||
    !user.email_confirmed_at
  )
    throw new Error(
      'Recovery requires the matching Auth user with a confirmed email. No accounts were changed.',
    )
  const { password, confirm } = await readPassword()
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new Error('Use a password of 12–128 characters. No accounts were changed.')
  if (password !== confirm) throw new Error('Passwords do not match. No accounts were changed.')
  const result = await admin.auth.admin.updateUserById(user.id, { password })
  if (result.error)
    fail(
      'Password update failed. Check the project password policy and operator key.',
      result.error,
    )
  if (result.data?.user?.id !== user.id)
    throw new Error('Password update could not be confirmed. Do not assume it succeeded.')
  return 'Admin password updated. Sign in with DEVCARE_ADMIN_EMAIL and your chosen password. No recovery email was requested.'
}
