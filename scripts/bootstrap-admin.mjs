import { createClient } from '@supabase/supabase-js'
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEVCARE_ADMIN_EMAIL, DEVCARE_SITE_URL } =
  process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DEVCARE_ADMIN_EMAIL || !DEVCARE_SITE_URL)
  throw new Error('Configure the four variables in .env.admin.example first.')
if (!/^https:\/\//.test(DEVCARE_SITE_URL) && !/^http:\/\/localhost(:\d+)?$/.test(DEVCARE_SITE_URL))
  throw new Error('Use an HTTPS site URL (localhost is allowed for development).')
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: admins, error: lookup } = await admin
  .from('profiles')
  .select('id')
  .eq('role', 'admin')
  .limit(1)
if (lookup)
  throw new Error('Profile lookup failed. Apply migrations and verify operator configuration.')
if (admins.length)
  throw new Error(
    'An admin already exists. Bootstrap refused. Use the documented operator recovery procedure.',
  )
const email = DEVCARE_ADMIN_EMAIL.trim().toLowerCase()
const existing = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
if (existing.error) throw new Error('Account lookup failed.')
let id = existing.data?.id
let needsInvitation = !id
if (id) {
  const current = await admin.auth.admin.getUserById(id)
  if (current.error) throw new Error('Could not inspect invitation state.')
  needsInvitation = !current.data.user.email_confirmed_at
}
if (needsInvitation) {
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${DEVCARE_SITE_URL.replace(/\/$/, '')}/accept-invitation`,
    data: { display_name: 'Developer' },
  })
  if (invite.error || !invite.data.user)
    throw new Error('Admin invitation failed. Check SMTP, Site URL and callback allowlist.')
  id = invite.data.user.id
}
const { error } = await admin.from('profiles').update({ role: 'admin', active: true }).eq('id', id)
if (error) throw new Error('Admin promotion failed. Review the operator SQL procedure.')
console.log(
  'First admin created. Use the invitation email to set your password, or sign in with your existing account. Remove .env.admin after setup and protect the operator key.',
)
