import { describe, expect, it } from 'vitest'
import { frontendConfigError } from './config'

describe('frontend Supabase configuration', () => {
  it('accepts project API and loopback origins', () => {
    expect(frontendConfigError('https://project.supabase.co', 'sb_publishable_test')).toBeNull()
    expect(frontendConfigError('http://127.0.0.1:54321', 'sb_publishable_test')).toBeNull()
  })
  it('explains dashboard URL mistakes before making auth requests', () => {
    expect(
      frontendConfigError('https://supabase.com/dashboard/project/project', 'sb_publishable_test'),
    ).toMatch(/project API origin/)
    expect(frontendConfigError('https://project.supabase.co/login', 'sb_publishable_test')).toMatch(
      /project API origin/,
    )
    expect(frontendConfigError('invalid', 'sb_publishable_test')).toMatch(/valid project API/)
  })
  it('rejects both server key formats without including their values in errors', () => {
    const jwt = `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`
    for (const key of ['sb_secret_sensitive', jwt]) {
      const error = frontendConfigError('https://project.supabase.co', key)
      expect(error).toMatch(/Remove server keys/)
      expect(error).not.toContain(key)
    }
    const anon = `header.${btoa(JSON.stringify({ role: 'anon' }))}.signature`
    expect(frontendConfigError('https://project.supabase.co', anon)).toBeNull()
  })
})
