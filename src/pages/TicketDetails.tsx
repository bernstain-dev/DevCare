import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCheck, Download, LockKeyhole, Paperclip, Save, Send } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { downloadAttachment, rpc, uploadFiles } from '../lib/api'
import { allowedTransitions, formatDate, replySchema } from '../lib/validation'
import {
  PRIORITIES,
  type Attachment,
  type Message,
  type Status,
  type Ticket,
  type TicketEvent,
} from '../lib/types'
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  FilePicker,
  Modal,
  Notice,
  PageTitle,
  Pagination,
  Spinner,
  Success,
} from '../components/ui'

function AttachmentList({ files }: { files: Attachment[] }) {
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <>
      {files.length > 0 && (
        <div className="attachment-list">
          {files.map((f) => (
            <button
              key={f.id}
              className="attachment"
              disabled={f.state !== 'ready' || busy === f.id}
              onClick={async () => {
                setError(null)
                setBusy(f.id)
                try {
                  await downloadAttachment(f)
                } catch (e) {
                  setError(e)
                } finally {
                  setBusy(null)
                }
              }}
            >
              <Paperclip size={16} />
              <span>
                {f.file_name}
                <small>
                  {(f.size_bytes / 1024).toFixed(0)} KB
                  {f.state === 'pending'
                    ? ' · Upload pending'
                    : f.state === 'deleting'
                      ? ' · Cleanup pending'
                      : ''}
                </small>
              </span>
              <Download size={16} />
            </button>
          ))}
        </div>
      )}
      {Boolean(error) && <ErrorBox error={error} />}
    </>
  )
}
function AddFiles({
  ticket,
  message = null,
  existing = 0,
}: {
  ticket: string
  message?: string | null
  existing?: number
}) {
  const cache = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  return existing < 3 ? (
    <details className="optional-details">
      <summary>Add attachments to {message ? 'your reply' : 'your report'}</summary>
      <FilePicker files={files} onChange={setFiles} existing={existing} disabled={busy} />
      {errors.map((e, i) => (
        <ErrorBox key={i} error={e} />
      ))}
      <button
        className="btn orange small"
        disabled={!files.length || busy}
        onClick={async () => {
          setBusy(true)
          try {
            const result = await uploadFiles(ticket, message, files)
            setFiles(result.failed)
            setErrors(result.errors)
            await cache.invalidateQueries()
          } finally {
            setBusy(false)
          }
        }}
      >
        <Paperclip size={15} />
        Upload Attachments
      </button>
    </details>
  ) : null
}
function StatusChange({
  ticket,
  target,
  onClose,
}: {
  ticket: Ticket
  target: Status
  onClose: () => void
}) {
  const cache = useQueryClient()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const title =
    target === 'Resolved'
      ? 'Resolve Ticket'
      : target === 'Closed'
        ? 'Confirm Resolution'
        : target === 'Open'
          ? 'Reopen Ticket'
          : `Set ${target}`
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await rpc('change_ticket_status', {
              p_ticket: ticket.id,
              p_status: target,
              p_reason: reason,
            })
            await cache.invalidateQueries()
            onClose()
          } catch (e) {
            setError(e)
          } finally {
            setBusy(false)
          }
        }}
      >
        {Boolean(error) && <ErrorBox error={error} />}
        <p>
          Change <strong>{ticket.reference}</strong> from <strong>{ticket.status}</strong> to{' '}
          <strong>{target}</strong>.
        </p>
        {target === 'Closed' ? (
          <Notice>
            Confirm that the resolution addresses your request. The conversation and history will be
            preserved.
          </Notice>
        ) : (
          <Field
            label={
              target === 'Resolved'
                ? 'Resolution summary *'
                : target === 'Open'
                  ? 'Reason for reopening *'
                  : 'Status update note (optional)'
            }
          >
            <textarea
              autoFocus
              required={target === 'Resolved' || target === 'Open'}
              minLength={target === 'Resolved' || target === 'Open' ? 1 : undefined}
              maxLength={10000}
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        <div className="form-actions">
          <button type="button" className="btn gray" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="btn orange">
            <CheckCheck size={17} />
            {title}
          </button>
        </div>
      </form>
    </Modal>
  )
}
function ReplyForm({ ticket }: { ticket: Ticket }) {
  const cache = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [saved, setSaved] = useState<Message | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const form = useForm<z.infer<typeof replySchema>>({
    resolver: zodResolver(replySchema),
    defaultValues: { body: '' },
  })
  async function attach(message: Message) {
    setBusy(true)
    try {
      const result = await uploadFiles(ticket.id, message.id, files)
      setFiles(result.failed)
      setErrors(result.errors)
      if (!result.failed.length) setSaved(null)
      await cache.invalidateQueries()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="reply-form">
      <h3>Keep the conversation going</h3>
      {Boolean(error) && <ErrorBox error={error} />}{' '}
      {saved ? (
        <>
          <Success>
            Your reply is saved. Retry the files below without sending another reply.
          </Success>
          {errors.map((e, i) => (
            <ErrorBox key={i} error={e} />
          ))}
          <FilePicker files={files} onChange={setFiles} disabled={busy} />
          <div className="form-actions">
            <button
              className="btn gray"
              disabled={busy}
              onClick={() => {
                setSaved(null)
                setFiles([])
                setErrors([])
              }}
            >
              Continue Without Files
            </button>
            <button
              className="btn orange"
              disabled={busy || !files.length}
              onClick={() => void attach(saved)}
            >
              Retry Failed Attachments
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={form.handleSubmit(async ({ body }) => {
            setError(null)
            try {
              const message = await rpc<Message>('send_reply', {
                p_ticket: ticket.id,
                p_body: body,
              })
              form.reset()
              setSaved(message)
              await attach(message)
            } catch (e) {
              setError(e)
            }
          })}
        >
          <Field label="Your reply" error={form.formState.errors.body?.message}>
            <textarea
              rows={4}
              placeholder="Add an update or ask a question…"
              {...form.register('body')}
            />
          </Field>
          <FilePicker files={files} onChange={setFiles} disabled={form.formState.isSubmitting} />
          <div className="form-actions">
            <button className="btn green" disabled={form.formState.isSubmitting}>
              <Send size={16} />
              {form.formState.isSubmitting ? 'Sending…' : 'Send Reply'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
function InternalNotes({ id }: { id: string }) {
  const cache = useQueryClient()
  const [page, setPage] = useState(1)
  const [error, setError] = useState<unknown>(null)
  const form = useForm<z.infer<typeof replySchema>>({
    resolver: zodResolver(replySchema),
    defaultValues: { body: '' },
  })
  const query = useQuery({
    queryKey: ['notes', id, page],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('internal_notes')
        .select('*', { count: 'exact' })
        .eq('ticket_id', id)
        .order('created_at', { ascending: false })
        .range((page - 1) * 10, page * 10 - 1)
      if (error) throw error
      return { rows: data as Message[], count: count ?? 0 }
    },
  })
  return (
    <section className="panel internal-panel">
      <div className="section-heading">
        <h2>
          <LockKeyhole size={18} />
          Internal notes
        </h2>
        <Badge value="Admin only" />
      </div>
      <div className="panel-padding">
        <Notice>
          Private to active administrators. Clients cannot access these notes through the UI or API.
        </Notice>
        {query.isPending ? (
          <Spinner />
        ) : query.error ? (
          <ErrorBox error={query.error} />
        ) : (
          <>
            {query.data.rows.map((n) => (
              <article className="note" key={n.id}>
                <div className="message-meta">
                  <strong>{n.author_name}</strong>
                  <time>{formatDate(n.created_at)}</time>
                </div>
                <p className="preserve-text">{n.body}</p>
              </article>
            ))}
            <Pagination page={page} count={query.data.count} size={10} onChange={setPage} />
          </>
        )}
        {Boolean(error) && <ErrorBox error={error} />}
        <form
          onSubmit={form.handleSubmit(async ({ body }) => {
            try {
              setError(null)
              await rpc('add_internal_note', { p_ticket: id, p_body: body })
              form.reset()
              await cache.invalidateQueries({ queryKey: ['notes', id] })
            } catch (e) {
              setError(e)
            }
          })}
        >
          <Field label="Private note" error={form.formState.errors.body?.message}>
            <textarea rows={3} {...form.register('body')} />
          </Field>
          <div className="form-actions">
            <button className="btn orange" disabled={form.formState.isSubmitting}>
              <LockKeyhole size={16} />
              Add Internal Note
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
export function TicketDetails() {
  const { id } = useParams()
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const cache = useQueryClient()
  const [messagePage, setMessagePage] = useState(1)
  const [eventPage, setEventPage] = useState(1)
  const [target, setTarget] = useState<Status | null>(null)
  const [priority, setPriority] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const query = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*,projects(name)')
        .eq('id', id!)
        .single()
      if (error) throw new Error('Ticket unavailable or access disabled.')
      const files = await supabase
        .from('attachments')
        .select('*')
        .eq('ticket_id', id!)
        .is('message_id', null)
        .order('created_at')
      if (files.error) throw files.error
      return { ticket: data as Ticket, files: files.data as Attachment[] }
    },
    refetchInterval: 30000,
  })
  const messages = useQuery({
    queryKey: ['messages', id, messagePage],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('ticket_messages')
        .select('*,attachments(*)', { count: 'exact' })
        .eq('ticket_id', id!)
        .order('created_at', { ascending: false })
        .range((messagePage - 1) * 10, messagePage * 10 - 1)
      if (error) throw error
      return {
        rows: (data as (Message & { attachments: Attachment[] })[]).reverse(),
        count: count ?? 0,
      }
    },
    enabled: Boolean(query.data),
    refetchInterval: 30000,
  })
  const events = useQuery({
    queryKey: ['events', id, eventPage],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('ticket_events')
        .select('*', { count: 'exact' })
        .eq('ticket_id', id!)
        .order('created_at', { ascending: false })
        .range((eventPage - 1) * 10, eventPage * 10 - 1)
      if (error) throw error
      return { rows: data as TicketEvent[], count: count ?? 0 }
    },
    enabled: Boolean(query.data),
    refetchInterval: 30000,
  })
  if (query.isPending) return <Spinner />
  if (query.error) return <ErrorBox error={query.error} retry={() => void query.refetch()} />
  const { ticket: t, files } = query.data
  return (
    <>
      <Link className="back-link" to="/tickets">
        ← All tickets
      </Link>
      <PageTitle
        eyebrow={t.reference}
        title={t.title}
        description={`${t.projects?.name} · Submitted by ${t.author_name} · ${formatDate(t.created_at)}`}
        action={<Badge value={t.status} />}
      />
      {Boolean(error) && <ErrorBox error={error} />}
      <div className="ticket-detail-grid">
        <div className="ticket-main">
          <section className="panel report-panel">
            <div className="section-heading">
              <h2>Original report</h2>
              <Badge value={t.request_type} />
            </div>
            <div className="panel-padding">
              <p className="preserve-text">{t.description}</p>
              {[
                ['Steps to reproduce', t.steps_to_reproduce],
                ['Expected behavior', t.expected_behavior],
                ['Actual behavior', t.actual_behavior],
                ['Affected version', t.affected_version],
                ['Device and browser', t.device_browser],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div className="report-detail" key={label}>
                    <h3>{label}</h3>
                    <p className="preserve-text">{value}</p>
                  </div>
                ))}
              <AttachmentList files={files} />
              {t.created_by === profile?.id && t.status !== 'Closed' && (
                <AddFiles ticket={t.id} existing={files.length} />
              )}
            </div>
          </section>
          {t.resolution_summary && (
            <section className="panel resolution-panel">
              <h2>
                <CheckCheck size={21} />
                Latest resolution summary
              </h2>
              <p className="preserve-text">{t.resolution_summary}</p>
              {t.status === 'Resolved' && (
                <p className="muted">
                  Confirm the resolution to close this ticket, or reopen it with a reason.
                </p>
              )}
            </section>
          )}
          <section className="panel">
            <div className="section-heading">
              <h2>Conversation</h2>
              <span className="muted">Public replies</span>
            </div>
            {messages.isPending ? (
              <Spinner />
            ) : messages.error ? (
              <ErrorBox error={messages.error} retry={() => void messages.refetch()} />
            ) : (
              <>
                {messages.data.rows.length ? (
                  <div className="conversation">
                    {messages.data.rows.map((m) => (
                      <article className="message" key={m.id}>
                        <span className="message-avatar">
                          {m.author_name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="message-content">
                          <div className="message-meta">
                            <strong>{m.author_name}</strong>
                            <time>{formatDate(m.created_at)}</time>
                          </div>
                          <p className="preserve-text">{m.body}</p>
                          <AttachmentList files={m.attachments} />
                          {m.author_id === profile?.id && t.status !== 'Closed' && (
                            <AddFiles
                              ticket={t.id}
                              message={m.id}
                              existing={m.attachments.length}
                            />
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty title="Start the conversation">
                    Replies and project updates will appear here.
                  </Empty>
                )}
                <Pagination
                  page={messagePage}
                  count={messages.data.count}
                  size={10}
                  onChange={setMessagePage}
                />
              </>
            )}
            {t.status === 'Closed' ? (
              <div className="panel-padding">
                <Notice>
                  This ticket is closed. An administrator can reopen it if more work is needed.
                </Notice>
              </div>
            ) : (
              <ReplyForm ticket={t} />
            )}
          </section>
          {admin && <InternalNotes id={t.id} />}
        </div>
        <aside className="ticket-aside">
          <section className="panel panel-padding">
            <h2>Ticket overview</h2>
            <dl className="overview-list">
              <div>
                <dt>Status</dt>
                <dd>
                  <Badge value={t.status} />
                </dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd>
                  <Badge value={t.priority} />
                </dd>
              </div>
              <div>
                <dt>Requested urgency</dt>
                <dd>{t.requested_urgency}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>
                  <Link className="text-link" to={`/projects/${t.project_id}`}>
                    {t.projects?.name}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{formatDate(t.updated_at)}</dd>
              </div>
            </dl>
            {admin && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  setBusy(true)
                  setError(null)
                  try {
                    await rpc('change_ticket_priority', {
                      p_ticket: t.id,
                      p_priority: priority || t.priority,
                    })
                    setPriority('')
                    await cache.invalidateQueries()
                  } catch (e) {
                    setError(e)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Field label="Set admin priority">
                  <select
                    value={priority || t.priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <button
                  className="btn orange full"
                  disabled={busy || !priority || priority === t.priority}
                >
                  <Save size={16} />
                  Save Changes
                </button>
              </form>
            )}
            <div className="status-actions">
              {allowedTransitions(t.status, admin).map((status) => (
                <button className="btn orange full" key={status} onClick={() => setTarget(status)}>
                  {status === 'Resolved'
                    ? 'Resolve Ticket'
                    : status === 'Closed'
                      ? 'Confirm Resolution'
                      : status === 'Open'
                        ? 'Reopen Ticket'
                        : `Set ${status}`}
                </button>
              ))}
            </div>
          </section>
          <section className="panel history-panel">
            <div className="section-heading">
              <h2>Activity history</h2>
            </div>
            {events.isPending ? (
              <Spinner />
            ) : events.error ? (
              <ErrorBox error={events.error} retry={() => void events.refetch()} />
            ) : (
              <>
                <div className="history-list">
                  {events.data.rows.map((event) => (
                    <article key={event.id}>
                      <strong>
                        {event.kind === 'created'
                          ? 'Ticket created'
                          : event.kind === 'reply_added'
                            ? 'Public reply added'
                            : event.kind === 'priority_changed'
                              ? `Priority: ${event.detail.from} → ${event.detail.to}`
                              : `${event.detail.from} → ${event.detail.to}`}
                      </strong>
                      {event.detail.reason && (
                        <p className="preserve-text">{event.detail.reason}</p>
                      )}
                      <span>{event.actor_name}</span>
                      <small>{formatDate(event.created_at)}</small>
                    </article>
                  ))}
                </div>
                <Pagination
                  page={eventPage}
                  count={events.data.count}
                  size={10}
                  onChange={setEventPage}
                />
              </>
            )}
          </section>
        </aside>
      </div>
      {target && <StatusChange ticket={t} target={target} onClose={() => setTarget(null)} />}
    </>
  )
}
