import { z } from 'zod'
import { PRIORITIES, REQUEST_TYPES, type Status } from './types'
export const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})
export const passwordSchema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters.').max(128),
    confirm: z.string(),
  })
  .refine((x) => x.password === x.confirm, { path: ['confirm'], message: 'Passwords must match.' })
export const ticketSchema = z.object({
  project_id: z.uuid('Select a project.'),
  request_type: z.enum(REQUEST_TYPES),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(20000),
  steps_to_reproduce: z.string().max(10000),
  expected_behavior: z.string().max(10000),
  actual_behavior: z.string().max(10000),
  affected_version: z.string().max(120),
  device_browser: z.string().max(500),
  requested_urgency: z.enum(PRIORITIES),
})
export const clientSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contact_email: z.union([z.email(), z.literal('')]),
  description: z.string().max(10000),
  active: z.boolean(),
})
export const projectSchema = z.object({
  client_id: z.uuid('Select a client account.'),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(10000),
  application_url: z.union([
    z.url().refine((x) => /^https?:\/\//.test(x), 'Use an HTTP or HTTPS URL.'),
    z.literal(''),
  ]),
  current_version: z.string().max(120),
  support_notes: z.string().max(10000),
  archived: z.boolean(),
})
export const replySchema = z.object({ body: z.string().trim().min(1, 'Write a reply.').max(20000) })
export function allowedTransitions(status: Status, admin: boolean): Status[] {
  if (status === 'Resolved') return ['Closed', 'Open']
  if (!admin) return []
  return {
    Open: ['In Progress', 'Waiting for Client', 'Resolved'],
    'In Progress': ['Waiting for Client', 'Resolved'],
    'Waiting for Client': ['In Progress', 'Resolved'],
    Closed: ['Open'],
  }[status] as Status[]
}
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const FILE_TYPES: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
}
export function fileError(files: File[], existing = 0): string | null {
  if (files.length + existing > 3) return 'Maximum three attachments per ticket or reply.'
  for (const f of files) {
    if (f.size < 1 || f.size > MAX_FILE_BYTES) return `${f.name}: use a nonempty file up to 5 MB.`
    if (
      f.name.length > 200 ||
      [...f.name].some((c) => c.charCodeAt(0) < 32) ||
      /[\\/]/.test(f.name) ||
      !FILE_TYPES[f.type]?.includes(f.name.split('.').pop()?.toLowerCase() ?? '')
    )
      return `${f.name}: only PNG, JPEG, WebP and PDF files with matching extensions are accepted.`
  }
  return null
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
export function dateBoundary(date: string, end = false) {
  return new Date(`${date}T${end ? '23:59:59.999' : '00:00:00'}+08:00`).toISOString()
}
