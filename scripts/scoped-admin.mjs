import { createClient } from '@supabase/supabase-js'
import { adminConfig } from './admin-setup.mjs'

// No secret, email, target UUID or backend response is printed by this operator tool.
export async function configureScopedAdmin(admin, env) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const action = env.DEVCARE_OPERATOR_ACTION
  if (!['configure', 'assign', 'remove', 'grant-operator', 'revoke-operator'].includes(action))
    throw new Error('Set a supported DEVCARE_OPERATOR_ACTION. See DEPLOYMENT.md.')
  const id = env.DEVCARE_TARGET_USER_ID?.trim()
  const email = env.DEVCARE_TARGET_EMAIL?.trim().toLowerCase()
  const clientId = env.DEVCARE_TARGET_CLIENT_ID?.trim()
  if (
    (id && !uuid.test(id)) ||
    (!id && !email) ||
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Error('Configure the existing target account by UUID or email.')
  if (['configure', 'assign', 'remove'].includes(action) && !uuid.test(clientId ?? ''))
    throw new Error('Configure an explicit target client UUID; no assignment is inferred.')
  let query = admin.from('profiles').select('id,email,role,active')
  query = id ? query.eq('id', id) : query.eq('email', email)
  const profile = await query.single()
  if (profile.error || !profile.data || (email && profile.data.email.toLowerCase() !== email))
    throw new Error('Target profile lookup failed. No assignment was made.')
  const auth = await admin.auth.admin.getUserById(profile.data.id)
  if (
    auth.error ||
    auth.data?.user?.id !== profile.data.id ||
    auth.data.user.email?.toLowerCase() !== profile.data.email.toLowerCase()
  )
    throw new Error('Target Auth/profile identity could not be verified. No assignment was made.')
  let result
  if (action === 'configure') {
    result = await admin.rpc('configure_administrator', {
      p_user: profile.data.id,
      p_client: clientId,
    })
  } else if (action === 'assign' || action === 'remove') {
    result = await admin.rpc('set_admin_membership', {
      p_user: profile.data.id,
      p_client: clientId,
      p_active: action === 'assign',
    })
  } else {
    result = await admin.rpc('set_platform_operator', {
      p_user: profile.data.id,
      p_active: action === 'grant-operator',
    })
  }
  if (result.error)
    throw new Error(
      'Operator assignment was rejected. Check the migration and reviewed account/client selection; backend details withheld.',
    )
  return 'Reviewed operator assignment completed. Existing Auth credentials and invitation state were preserved.'
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scoped-admin.mjs')) {
  try {
    const config = adminConfig(process.env)
    const admin = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    console.log(await configureScopedAdmin(admin, process.env))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Operator assignment failed.')
    process.exitCode = 1
  }
}
