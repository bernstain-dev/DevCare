import { createClient } from '@supabase/supabase-js'
import { adminConfig, bootstrapAdmin } from './admin-setup.mjs'

try {
  const config = adminConfig(process.env)
  const admin = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  console.log(await bootstrapAdmin(admin, config))
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Admin setup failed. Review DEPLOYMENT.md.',
  )
  process.exitCode = 1
}
