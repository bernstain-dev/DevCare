import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
if (process.env.DEVCARE_TEST_ALLOW_RESET !== 'YES_DISPOSABLE_PROJECT')
  throw new Error('Explicit disposable-project acknowledgement required.')
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Configure .env.test for a separate development project.')
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const tag = Date.now()
const email = `client-${tag}@example.test`
const password = randomBytes(24).toString('base64url')
const user = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: 'Development Client' },
})
if (user.error) throw new Error('Development user creation failed.')
const account = await admin
  .from('clients')
  .insert({ name: `Development account ${tag}` })
  .select()
  .single()
if (account.error) throw new Error('Development account creation failed.')
const member = await admin
  .from('client_memberships')
  .insert({ client_id: account.data.id, user_id: user.data.user.id })
const project = await admin
  .from('projects')
  .insert({
    client_id: account.data.id,
    name: 'Development project',
    description: 'Disposable testing data. Never import into production.',
  })
if (member.error || project.error) throw new Error('Development assignment failed.')
console.log(
  `Created development account and user ${email}. Set a password using the local Auth dashboard or recovery flow. Generated temporary credentials are intentionally not printed.`,
)
