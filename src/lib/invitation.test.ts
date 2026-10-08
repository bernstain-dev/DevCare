import { describe, expect, it } from 'vitest'
import {
  invitationCallback,
  invitationFailure,
} from '../../supabase/functions/admin-users/invitation'

describe('invitation configuration and safe failure reporting', () => {
  it.each(['http://127.0.0.1:5173', 'http://localhost:5173/', 'https://support.devcare.test'])(
    'uses the exact callback for %s',
    (site) => {
      expect(invitationCallback(site)).toBe(`${new URL(site).origin}/accept-invitation`)
    },
  )
  it.each([
    undefined,
    'invalid',
    'http://127.0.0.1:5173/login',
    'https://support.devcare.test?token=secret',
    'http://support.devcare.test',
    'https://user:password@support.devcare.test',
  ])('rejects invalid or unsafe origins: %s', (site) => {
    expect(invitationCallback(site)).toBeNull()
  })
  it('distinguishes external-recipient restrictions from rate limits', () => {
    const restricted = invitationFailure({ code: 'email_address_not_authorized' })
    expect(restricted.status).toBe(403)
    expect(restricted.message).toMatch(/Configure custom SMTP/)
    expect(restricted.message).toMatch(/Waiting for the rate limit alone will not fix/)
    const limited = invitationFailure({ code: 'over_email_send_rate_limit' })
    expect(limited.status).toBe(429)
    expect(limited.message).toMatch(/quota to reset/)
  })
  it.each(['email_exists', 'user_already_exists'])(
    'reports existing Auth accounts for %s',
    (code) => {
      expect(invitationFailure({ code })).toMatchObject({ status: 409, code })
      expect(invitationFailure({ code }).message).toMatch(/do not create a duplicate/)
    },
  )
  it.each(['email_provider_disabled', 'provider_disabled', 'signup_disabled', 'otp_disabled'])(
    'keeps public registration disabled when reporting %s',
    (code) => {
      expect(invitationFailure({ code }).message).toMatch(/Keep public registration disabled/)
    },
  )
  it('preserves request rate limiting separately from email limits', () => {
    expect(invitationFailure({ code: 'over_request_rate_limit' }).status).toBe(429)
    expect(invitationFailure({ status: 429 }).code).toBe('auth_rate_limited')
  })
  it('never passes through untrusted error codes or response bodies', () => {
    const result = invitationFailure({ code: 'secret_token_from_an_unknown_error' })
    expect(result.code).toBe('invitation_failed')
    expect(JSON.stringify(result)).not.toContain('secret_token')
    expect(invitationFailure(null).status).toBe(502)
    expect(invitationFailure({ code: 'unexpected_failure' }).message).toMatch(/Authentication logs/)
  })
})
