import { supabase } from './supabase'
import { fileError } from './validation'
import type { Attachment, Ticket } from './types'

export async function rpc<T = void>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}
export async function edge<T>(name: string, body: Record<string, unknown> | FormData): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context instanceof Response) {
      const payload = await context.json().catch(() => null)
      throw new Error(payload?.error ?? 'The request failed. Please retry.')
    }
    throw new Error(error.message)
  }
  return data as T
}
export async function uploadFiles(
  ticketId: string,
  messageId: string | null,
  files: File[],
): Promise<{ failed: File[]; errors: string[] }> {
  const invalid = fileError(files)
  if (invalid) return { failed: files, errors: [invalid] }
  const failed: File[] = []
  const errors: string[] = []
  // Sequential uploads make partial failures explicit and respect server-side reservations.
  for (const file of files) {
    try {
      const form = new FormData()
      form.set('ticket_id', ticketId)
      if (messageId) form.set('message_id', messageId)
      form.set('file', file)
      await edge('files', form)
    } catch (error) {
      failed.push(file)
      errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`)
    }
  }
  return { failed, errors }
}
export async function downloadAttachment(file: Attachment) {
  const { url } = await edge<{ url: string }>('files', {
    action: 'download',
    attachment_id: file.id,
  })
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener noreferrer'
  a.download = file.file_name
  document.body.appendChild(a)
  a.click()
  a.remove()
}
export async function createTicket(values: Record<string, unknown>): Promise<Ticket> {
  return rpc<Ticket>('create_ticket', {
    p_project: values.project_id,
    p_type: values.request_type,
    p_title: values.title,
    p_description: values.description,
    p_steps: values.steps_to_reproduce,
    p_expected: values.expected_behavior,
    p_actual: values.actual_behavior,
    p_version: values.affected_version,
    p_device: values.device_browser,
    p_urgency: values.requested_urgency,
  })
}
