export const STATUSES = ['Open', 'In Progress', 'Waiting for Client', 'Resolved', 'Closed'] as const
export const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const
export const REQUEST_TYPES = [
  'Bug Report',
  'Complaint',
  'Feature Request',
  'General Question',
] as const
export type Status = (typeof STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type RequestType = (typeof REQUEST_TYPES)[number]
export interface Profile {
  id: string
  email: string
  display_name: string
  role: 'admin' | 'client'
  active: boolean
  created_at: string
}
export interface Client {
  id: string
  name: string
  contact_email: string
  description: string
  active: boolean
  created_at: string
}
export interface Membership {
  id: string
  client_id: string
  user_id: string
  active: boolean
  created_at: string
}
export interface Project {
  id: string
  client_id: string
  name: string
  description: string
  application_url: string | null
  current_version: string | null
  support_notes: string
  archived: boolean
  created_at: string
}
export interface Ticket {
  id: string
  reference: string
  project_id: string
  client_id: string
  created_by: string
  author_name: string
  title: string
  description: string
  request_type: RequestType
  priority: Priority
  requested_urgency: Priority
  status: Status
  steps_to_reproduce: string
  expected_behavior: string
  actual_behavior: string
  affected_version: string
  device_browser: string
  resolution_summary: string | null
  created_at: string
  updated_at: string
  projects?: { name: string }
}
export interface Message {
  id: string
  ticket_id: string
  author_id: string
  author_name: string
  body: string
  created_at: string
}
export interface Attachment {
  id: string
  ticket_id: string
  message_id: string | null
  created_by: string
  file_name: string
  size_bytes: number
  mime_type: string
  state: 'ready' | 'pending' | 'deleting'
  created_at: string
}
export interface TicketEvent {
  id: string
  ticket_id: string
  actor_name: string
  kind: string
  detail: { from?: string; to?: string; reason?: string }
  created_at: string
  tickets?: { reference: string; title: string }
}
export interface Notification {
  id: string
  ticket_id: string
  title: string
  read_at: string | null
  created_at: string
}
