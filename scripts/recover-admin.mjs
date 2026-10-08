import { createClient } from '@supabase/supabase-js'
import { adminConfig, recoverAdminPassword } from './admin-setup.mjs'
import { hiddenPassword } from './operator-prompt.mjs'

try {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      'Run npm run recover:admin in your own interactive terminal. Do not put passwords in commands or chat.',
    )
  const config = adminConfig(process.env)
  const admin = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  console.log(
    'Recovering the existing active admin configured in .env.admin. Password input is hidden.',
  )
  console.log(
    await recoverAdminPassword(admin, config.email, async () => ({
      password: await hiddenPassword('New password (12–128 characters): '),
      confirm: await hiddenPassword('Confirm password: '),
    })),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Admin recovery failed.')
  process.exitCode = 1
}
