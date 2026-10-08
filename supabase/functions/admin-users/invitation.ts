type AuthFailure = { code?: string; status?: number } | null | undefined

// Use trusted error codes, never SMTP/API response text, emails or tokens.
export function invitationFailure(error: AuthFailure): {
  status: number
  message: string
  code: string
} {
  switch (error?.code) {
    case 'over_email_send_rate_limit':
      return {
        status: 429,
        code: error.code,
        message:
          'Supabase’s Auth email sending limit has been reached. Wait for the quota to reset or configure custom SMTP and review Authentication → Rate Limits. Your client account is saved; no login was assigned.',
      }
    case 'over_request_rate_limit':
      return {
        status: 429,
        code: error.code,
        message:
          'Supabase temporarily limited invitation requests. Wait a few minutes before trying again. Your client account is saved.',
      }
    case 'email_address_not_authorized':
      return {
        status: 403,
        code: error.code,
        message:
          'Supabase’s default email service cannot send to this client. Configure custom SMTP in Supabase → Authentication → Email → SMTP Settings, then retry Invite User. Waiting for the rate limit alone will not fix this restriction.',
      }
    case 'email_address_invalid':
      return {
        status: 400,
        code: error.code,
        message:
          'Supabase rejected this email address. Enter a real, deliverable address; example/test domains are not supported by hosted Auth.',
      }
    case 'email_exists':
    case 'user_already_exists':
      return {
        status: 409,
        code: error.code,
        message:
          'This email already exists in Supabase Auth. Review its profile and invitation state in Authentication → Users before retrying; do not create a duplicate account.',
      }
    case 'email_provider_disabled':
    case 'provider_disabled':
    case 'signup_disabled':
    case 'otp_disabled':
      return {
        status: 503,
        code: error.code,
        message:
          'Supabase rejected email invitations because an Auth feature is disabled. Check the email provider/invitation configuration. Keep public registration disabled.',
      }
    case 'unexpected_failure':
    case 'unexpected_error':
    case 'hook_timeout':
    case 'hook_timeout_after_retry':
      return {
        status: 502,
        code: error.code,
        message:
          'Supabase could not complete the invitation. Check Authentication logs for SMTP delivery, email template, hook or profile-trigger errors. Your client account is saved.',
      }
    default:
      return error?.status === 429
        ? {
            status: 429,
            code: 'auth_rate_limited',
            message:
              'Supabase temporarily rate-limited invitations. Check Authentication → Rate Limits and retry after the cooldown. Your client account is saved.',
          }
        : {
            status: 502,
            code: 'invitation_failed',
            message:
              'Supabase could not complete the invitation. Check Authentication logs and custom SMTP configuration. Your client account is saved; no login was assigned.',
          }
  }
}

export function invitationCallback(site: string | undefined): string | null {
  if (!site) return null
  try {
    const url = new URL(site)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return null
    return `${url.origin}/accept-invitation`
  } catch {
    return null
  }
}
