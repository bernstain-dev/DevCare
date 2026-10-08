import {
  boundedBody,
  caller,
  cors,
  elevated,
  failure,
  HttpError,
  json,
  requireAdmin,
} from '../_shared/http.ts'
import { invitationCallback, invitationFailure } from './invitation.ts'

Deno.serve(async (req) => {
  let headers: HeadersInit = {}
  try {
    headers = cors(req)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') throw new HttpError(405, 'POST required')
    const { userClient } = await caller(req)
    await requireAdmin(userClient)
    const body = JSON.parse(new TextDecoder().decode(await boundedBody(req, 8192)))
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const name = String(body.name ?? '').trim()
    const clientId = String(body.client_id ?? '')
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      name.length < 1 ||
      name.length > 120 ||
      !/^[0-9a-f-]{36}$/i.test(clientId)
    )
      throw new HttpError(400, 'Provide a valid email, name and client account')
    const account = await userClient.from('clients').select('id,active').eq('id', clientId).single()
    if (account.error || !account.data.active)
      throw new HttpError(400, 'Select an active client account')
    const admin = elevated()
    const existing = await admin
      .from('profiles')
      .select('id,role,active')
      .eq('email', email)
      .maybeSingle()
    if (existing.error) throw new HttpError(500, 'Could not check existing membership')
    if (existing.data && (existing.data.role !== 'client' || !existing.data.active))
      throw new HttpError(
        400,
        'This user is an administrator or disabled. Review their access first.',
      )
    let userId = existing.data?.id
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
            operation: 'client_invitation',
            code: detail.code,
            status: detail.status,
          }),
        )
        throw new HttpError(detail.status, `${detail.message} (${detail.code})`)
      }
      userId = result.data.user.id
      invited = true
    }
    // Caller-scoped RPC rechecks admin rights, even if access changed during SMTP delivery.
    const membership = await userClient.rpc('set_membership', {
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
          : 'Existing user assigned to this client account.',
      },
      200,
      headers,
    )
  } catch (error) {
    return failure(error, headers)
  }
})
