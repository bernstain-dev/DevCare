import { createClient } from '@supabase/supabase-js'
import { frontendConfigError } from './config'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const configurationError = frontendConfigError(url, key)
export const configured = configurationError === null
export const supabase = createClient(
  configured ? url : 'https://unconfigured.supabase.co',
  configured ? key : 'unconfigured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  },
)
