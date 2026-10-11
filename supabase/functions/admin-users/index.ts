import {
  boundedBody,
  caller,
  cors,
  elevated,
  failure,
  HttpError,
  json,
  requirePlatformOperator,
} from '../_shared/http.ts'
import { invitationCallback, invitationFailure } from './invitation.ts'

Deno.serve(async (req) => {
  let headers: HeadersInit = {}
  try {
    headers = cors(req)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') throw new HttpError(405, 'POST required')
    const { userClient } = await caller(req)
    const body = JSON.parse(new TextDecoder().decode(await boundedBody(req, 8192)))
    const action = body.action ?? 'invite_client'
    if (
      !['invite_client', 'invite_administrator', 'convert_administrator'].includes(action) ||
      'role' in body
    )
      throw new HttpError(400, 'Use an explicit supported invitation operation')
    const administrator = action !== 'invite_client'
    if (administrator) await requirePlatformOperator(userClient)
    const clientId = String(body.client_id ?? '')
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(clientId)) throw new HttpError(400, 'Select an active client account')
    const account = await userClient.from('clients').select('id,active').eq('id', clientId).single()
    if (account.error || !account.data?.active)
      throw new HttpError(403, 'Client unavailable or access disabled')
    if (action === 'convert_administrator') {
      const userId = String(body.user_id ?? '')
      if (!uuid.test(userId)) throw new HttpError(400, 'Select an existing user')
      const lookup = await elevated().auth.admin.getUserById(userId)
      if (lookup.error || lookup.data.user?.id !== userId)
        throw new HttpError(404, 'Existing account unavailable')
      const converted = await userClient.rpc('configure_administrator', {
        p_user: userId,
        p_client: clientId,
      })
      if (converted.error)
        throw new HttpError(
          409,
          'Conversion was not completed. Review the active profile and client assignment.',
        )
      return json(
        { message: 'Existing account converted and assigned. Sign-in details were preserved.' },
        200,
        headers,
      )
    }
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const name = String(body.name ?? '').trim()
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      name.length < 1 ||
      name.length > 120 ||
      !uuid.test(clientId)
    )
      throw new HttpError(400, 'Provide a valid email, name and client account')
    let existingId: string | null = null
    if (!administrator) {
      // Check the existing user's complete tenant scope before elevated Auth access.
      const authorized = await userClient.rpc('authorize_client_invitation', {
        p_client: clientId,
        p_email: email,
      })
      if (authorized.error) throw new HttpError(403, 'User unavailable for this client')
      existingId = authorized.data
    }
    const admin = elevated()
    if (administrator) {
      const existing = await admin
        .from('profiles')
        .select('id,active')
        .eq('email', email)
        .maybeSingle()
      if (existing.error || (existing.data && !existing.data.active))
        throw new HttpError(409, 'Existing account unavailable. Review its access before retrying.')
      existingId = existing.data?.id ?? null
    }
    let userId = existingId
    let invited = false
    let needsInvitation = !userId
    if (userId) {
      const lookup = await admin.auth.admin.getUserById(userId)
      if (lookup.error) throw new HttpError(500, 'Could not inspect invitation state')
      needsInvitation = !lookup.data.user.email_confirmed_at
    }
    if (needsInvitation) {
      const redirectTo = invitationCallback(Deno.env.get('SITE_URL'))
      if (!redirectTo)
        throw new HttpError(
          500,
          'Set the Edge Function SITE_URL to the frontend origin, without /login or another path, and allow its exact /accept-invitation callback in Auth settings.',
        )
      const result = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { display_name: name },
      })
      if (result.error || !result.data.user) {
        const detail = invitationFailure(result.error)
        console.warn(
          JSON.stringify({
            operation: action,
            code: detail.code,
            status: detail.status,
          }),
        )
        throw new HttpError(detail.status, `${detail.message} (${detail.code})`)
      }
      userId = result.data.user.id
      invited = true
    }
    // Caller-scoped RPC rechecks scope/operator rights after Auth or SMTP work.
    const membership = administrator
      ? await userClient.rpc('configure_administrator', { p_client: clientId, p_user: userId })
      : await userClient.rpc('set_membership', {
          p_client: clientId,
          p_user: userId,
          p_active: true,
        })
    if (membership.error)
      throw new HttpError(
        409,
        'User exists but membership was not saved. Retry to safely complete the assignment.',
      )
    return json(
      {
        invited,
        user_id: userId,
        message: invited
          ? 'Invitation sent and membership assigned.'
          : administrator
            ? 'Existing administrator account assigned. Sign-in details were preserved.'
            : 'Existing user assigned to this client account.',
      },
      200,
      headers,
    )
  } catch (error) {
    return failure(error, headers)
  }
})
