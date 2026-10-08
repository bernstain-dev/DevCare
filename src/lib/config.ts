export function frontendConfigError(url?: string, key?: string): string | null {
  if (!url || !key || /YOUR_PROJECT|YOUR_KEY/.test(`${url} ${key}`))
    return 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart the development server.'
  try {
    const parsed = new URL(url)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if (
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
      parsed.hostname === 'supabase.com' ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      return 'VITE_SUPABASE_URL must be your project API origin (https://PROJECT_REF.supabase.co), not the Supabase dashboard address.'
  } catch {
    return 'VITE_SUPABASE_URL must be a valid project API URL.'
  }
  let role: string | undefined
  try {
    role = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role
  } catch {
    /* Publishable keys are opaque. */
  }
  if (key.startsWith('sb_secret_') || role === 'service_role')
    return 'Use a publishable or legacy anon key for VITE_SUPABASE_PUBLISHABLE_KEY. Remove server keys from frontend environment variables.'
  return null
}
