import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export function cors(req: Request): HeadersInit {
  const origin = req.headers.get('origin')
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('SITE_URL') ?? '')
    .split(',')
    .map((x) => x.trim())
  if (origin && !allowed.includes(origin)) throw new HttpError(403, 'Origin not allowed')
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  }
}
export function json(data: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
export async function caller(req: Request) {
  const authorization = req.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sign in required')
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
  const { data, error } = await userClient.auth.getUser(authorization.slice(7))
  if (error || !data.user) throw new HttpError(401, 'Session expired. Please sign in again.')
  const active = await userClient.rpc('is_active_user')
  if (active.error || active.data !== true) throw new HttpError(403, 'Account disabled')
  return { userClient, user: data.user }
}
export async function requireAdmin(userClient: Awaited<ReturnType<typeof caller>>['userClient']) {
  const { data, error } = await userClient.rpc('is_admin')
  if (error || data !== true) throw new HttpError(403, 'Active administrator required')
}
// Call only AFTER authentication and the operation-specific authorization check.
export function elevated() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
export async function boundedBody(req: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(req.headers.get('content-length')) > max) throw new HttpError(413, 'Request too large')
  const reader = req.body?.getReader()
  if (!reader) throw new HttpError(400, 'Request body required')
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel()
      throw new HttpError(413, 'Request too large')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
export function failure(error: unknown, headers: HeadersInit) {
  return json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : 'Operation failed. Try again or contact your developer.',
    },
    error instanceof HttpError ? error.status : 500,
    headers,
  )
}
