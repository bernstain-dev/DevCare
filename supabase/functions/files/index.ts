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
import { MAX_BYTES, validFile } from './validation.ts'

Deno.serve(async (req) => {
  let headers: HeadersInit = {}
  try {
    headers = cors(req)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (req.method !== 'POST') throw new HttpError(405, 'POST required')
    const { userClient } = await caller(req)
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const bytes = await boundedBody(req, MAX_BYTES + 16384)
      const form = await new Response(bytes, {
        headers: { 'Content-Type': req.headers.get('content-type')! },
      }).formData()
      const file = form.get('file')
      const ticket = String(form.get('ticket_id') ?? '')
      const message = form.get('message_id') ? String(form.get('message_id')) : null
      if (!(file instanceof File)) throw new HttpError(400, 'File required')
      const content = new Uint8Array(await file.arrayBuffer())
      if (!validFile(file.name, file.type, content))
        throw new HttpError(
          400,
          'Use a valid PNG, JPEG, WebP or PDF file, up to 5 MB, with the matching extension.',
        )
      const reservation = await userClient.rpc('reserve_attachment', {
        p_ticket: ticket,
        p_message: message,
        p_name: file.name,
        p_mime: file.type,
        p_size: file.size,
      })
      if (reservation.error) throw new HttpError(403, reservation.error.message)
      const attachment = reservation.data
      const admin = elevated()
      try {
        const upload = await admin.storage
          .from('ticket-attachments')
          .upload(attachment.object_path, content, { contentType: file.type, upsert: false })
        if (upload.error)
          throw new HttpError(
            502,
            'Storage upload failed. Your report or reply is saved; retry the attachment.',
          )
        const finish = await userClient.rpc('finalize_attachment', { p_attachment: attachment.id })
        if (finish.error)
          throw new HttpError(409, 'Upload could not be finalized. Check account access and retry.')
        return json({ id: attachment.id }, 200, headers)
      } catch (error) {
        // Claim under a row lock before cleanup. If finalization committed but its
        // response was lost, preserve that ready object and report success.
        const claim = await admin
          .from('attachments')
          .update({ state: 'deleting' })
          .eq('id', attachment.id)
          .eq('state', 'pending')
          .select('id')
        if (claim.error) throw error
        if (!claim.data.length) {
          const current = await admin
            .from('attachments')
            .select('state')
            .eq('id', attachment.id)
            .maybeSingle()
          if (current.data?.state === 'ready') return json({ id: attachment.id }, 200, headers)
          throw error
        }
        // Failed removals retain their deleting row for the next safe sweep.
        const removed = await admin.storage
          .from('ticket-attachments')
          .remove([attachment.object_path])
        if (!removed.error)
          await admin.from('attachments').delete().eq('id', attachment.id).eq('state', 'deleting')
        throw error
      }
    }
    const body = JSON.parse(new TextDecoder().decode(await boundedBody(req, 8192)))
    if (body.action === 'download') {
      const result = await userClient
        .from('attachments')
        .select('object_path,file_name')
        .eq('id', body.attachment_id)
        .eq('state', 'ready')
        .single()
      if (result.error) throw new HttpError(404, 'Attachment unavailable or access disabled')
      const signed = await elevated()
        .storage.from('ticket-attachments')
        .createSignedUrl(result.data.object_path, 60, { download: result.data.file_name })
      if (signed.error) throw new HttpError(502, 'Download unavailable. Try again.')
      return json({ url: signed.data.signedUrl, expires_in: 60 }, 200, headers)
    }
    if (body.action === 'cleanup') {
      await requireAdmin(userClient)
      const admin = elevated()
      const stale = await admin.rpc('claim_abandoned_attachments')
      if (stale.error) throw new HttpError(500, 'Cleanup lookup failed')
      let removed = 0
      for (const row of stale.data) {
        const result = await admin.storage.from('ticket-attachments').remove([row.object_path])
        if (!result.error) {
          const deleted = await admin
            .from('attachments')
            .delete()
            .eq('id', row.id)
            .eq('state', 'deleting')
          if (!deleted.error) removed++
        }
      }
      return json({ removed, more_possible: stale.data.length === 100 }, 200, headers)
    }
    throw new HttpError(400, 'Unknown file operation')
  } catch (error) {
    return failure(error, headers)
  }
})
