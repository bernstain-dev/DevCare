import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const configured = Boolean(
  url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_KEY'),
)
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
