import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, RotateCcw, Send } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { useProjects } from '../lib/queries'
import { createTicket, uploadFiles } from '../lib/api'
import { STATUSES, PRIORITIES, REQUEST_TYPES, type Ticket } from '../lib/types'
import { dateBoundary, ticketSchema } from '../lib/validation'
import {
  Empty,
  ErrorBox,
  Field,
  FilePicker,
  Notice,
  PageTitle,
  Pagination,
  Spinner,
  Success,
} from '../components/ui'
import { TicketTable } from '../components/TicketTable'

export function Tickets() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const projects = useProjects()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const change = (key: string, value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
      return next
    })
  }
  const query = useQuery({
    queryKey: ['tickets', params.toString()],
    queryFn: async () => {
      let q = supabase
        .from('tickets')
        .select('*,projects(name)', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range((page - 1) * 12, page * 12 - 1)
      for (const [key, column] of [
        ['project', 'project_id'],
        ['status', 'status'],
        ['type', 'request_type'],
        ['priority', 'priority'],
      ]) {
        const value = params.get(key)
        if (value) q = q.eq(column, value)
      }
      const search = params.get('q')?.trim()
      if (search) {
        const safe = search.replace(/[^\p{L}\p{N}\s-]/gu, '').slice(0, 180)
        if (safe)
          q = q.or(`title.ilike.%${safe}%,reference.ilike.%${safe}%,description.ilike.%${safe}%`)
      }
      const from = params.get('from')
      const to = params.get('to')
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte('created_at', dateBoundary(from))
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lte('created_at', dateBoundary(to, true))
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as Ticket[], count: count ?? 0 }
    },
  })
  return (
    <>
      <PageTitle
        title={profile?.role === 'admin' ? 'All Tickets' : 'My Tickets'}
        description="Every request, conversation, and next step."
        action={
          <Link className="btn green" to="/tickets/new">
            <Plus size={18} />
            Submit Ticket
          </Link>
        }
      />
      <div className="panel ticket-filters">
        <div className="filter-grid">
          <Field label="Search tickets">
            <input
              placeholder="Title, reference or description…"
              value={params.get('q') ?? ''}
              onChange={(e) => change('q', e.target.value)}
            />
          </Field>
          <Field label="Project">
            <select
              value={params.get('project') ?? ''}
              onChange={(e) => change('project', e.target.value)}
            >
              <option value="">All projects</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={params.get('status') ?? ''}
              onChange={(e) => change('status', e.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Request type">
            <select
              value={params.get('type') ?? ''}
              onChange={(e) => change('type', e.target.value)}
            >
              <option value="">All types</option>
              {REQUEST_TYPES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={params.get('priority') ?? ''}
              onChange={(e) => change('priority', e.target.value)}
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Created from (Manila)">
            <input
              type="date"
              value={params.get('from') ?? ''}
              onChange={(e) => change('from', e.target.value)}
            />
          </Field>
          <Field label="Created to (Manila)">
            <input
              type="date"
              min={params.get('from') ?? undefined}
              value={params.get('to') ?? ''}
              onChange={(e) => change('to', e.target.value)}
            />
          </Field>
          <button className="btn gray reset-filter" onClick={() => setParams({})}>
            <RotateCcw size={16} />
            Reset Filters
          </button>
        </div>
        {projects.error && (
          <ErrorBox error={projects.error} retry={() => void projects.refetch()} />
        )}
      </div>
      <section className="panel">
        {query.isPending ? (
          <Spinner />
        ) : query.error ? (
          <ErrorBox error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <TicketTable tickets={query.data.rows} />
            <Pagination
              page={page}
              count={query.data.count}
              onChange={(value) =>
                setParams((prev) => {
                  const next = new URLSearchParams(prev)
                  next.set('page', String(value))
                  return next
                })
              }
            />
          </>
        )}
      </section>
    </>
  )
}
export function SubmitTicket() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const projects = useProjects()
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState<Ticket | null>(null)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const form = useForm<z.infer<typeof ticketSchema>>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      project_id: params.get('project') ?? '',
      request_type: 'Bug Report',
      title: '',
      description: '',
      steps_to_reproduce: '',
      expected_behavior: '',
      actual_behavior: '',
      affected_version: '',
      device_browser: '',
      requested_urgency: 'Normal',
    },
  })
  const requestType = useWatch({ control: form.control, name: 'request_type' })
  const projectId = useWatch({ control: form.control, name: 'project_id' })
  const selected = projects.data?.find((p) => p.id === projectId)
  async function upload(ticket: Ticket) {
    setBusy(true)
    try {
      const result = await uploadFiles(ticket.id, null, files)
      setFiles(result.failed)
      setUploadErrors(result.errors)
      await cache.invalidateQueries()
      if (!result.failed.length) navigate(`/tickets/${ticket.id}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageTitle
        title="Submit Ticket"
        description="Tell us what’s happening. A little detail makes a big difference."
      />
      {projects.isPending ? (
        <Spinner />
      ) : projects.error ? (
        <ErrorBox error={projects.error} retry={() => void projects.refetch()} />
      ) : !projects.data.some((p) => !p.archived) ? (
        <Empty title="No active projects available">
          Your developer needs to assign an active project before you can submit a ticket.
        </Empty>
      ) : (
        <div className="form-page-grid">
          <section className="panel form-panel">
            {Boolean(error) && <ErrorBox error={error} />}{' '}
            {saved ? (
              <>
                <Success>
                  {saved.reference} was saved. Your ticket will not be submitted twice.
                </Success>
                {uploadErrors.map((message, i) => (
                  <ErrorBox key={i} error={message} />
                ))}
                <FilePicker files={files} onChange={setFiles} disabled={busy} />
                <div className="form-actions">
                  <Link className="btn blue" to={`/tickets/${saved.id}`}>
                    View Ticket
                  </Link>
                  <button
                    className="btn orange"
                    disabled={busy || !files.length}
                    onClick={() => void upload(saved)}
                  >
                    Retry Failed Attachments
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={form.handleSubmit(async (values) => {
                  setError(null)
                  try {
                    const ticket = await createTicket(values)
                    setSaved(ticket)
                    await upload(ticket)
                  } catch (e) {
                    setError(e)
                  }
                })}
              >
                <h2>Request details</h2>
                <div className="form-grid">
                  <Field
                    label="Assigned project *"
                    error={form.formState.errors.project_id?.message}
                  >
                    <select {...form.register('project_id')}>
                      <option value="">Select your project</option>
                      {projects.data
                        .filter((p) => !p.archived)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Request type *" error={form.formState.errors.request_type?.message}>
                    <select {...form.register('request_type')}>
                      {REQUEST_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                {selected?.current_version && (
                  <p className="muted">Current project version: {selected.current_version}</p>
                )}
                {requestType === 'Feature Request' && (
                  <Notice>
                    Submitting a feature request does not approve additional work or fees. Scope,
                    cost and timing will be discussed separately.
                  </Notice>
                )}
                <Field label="Title *" error={form.formState.errors.title?.message}>
                  <input
                    placeholder="A clear, short summary of your request"
                    {...form.register('title')}
                  />
                </Field>
                <Field label="Description *" error={form.formState.errors.description?.message}>
                  <textarea
                    rows={6}
                    placeholder="What happened, or what would you like help with?"
                    {...form.register('description')}
                  />
                </Field>
                <details className="optional-details">
                  <summary>Additional context (optional)</summary>
                  <Field
                    label="Steps to reproduce"
                    error={form.formState.errors.steps_to_reproduce?.message}
                  >
                    <textarea rows={3} {...form.register('steps_to_reproduce')} />
                  </Field>
                  <div className="form-grid">
                    <Field
                      label="Expected behavior"
                      error={form.formState.errors.expected_behavior?.message}
                    >
                      <textarea rows={3} {...form.register('expected_behavior')} />
                    </Field>
                    <Field
                      label="Actual behavior"
                      error={form.formState.errors.actual_behavior?.message}
                    >
                      <textarea rows={3} {...form.register('actual_behavior')} />
                    </Field>
                    <Field
                      label="Affected application version"
                      error={form.formState.errors.affected_version?.message}
                    >
                      <input {...form.register('affected_version')} />
                    </Field>
                    <Field
                      label="Device and browser"
                      error={form.formState.errors.device_browser?.message}
                    >
                      <input
                        placeholder="e.g. Android, Chrome"
                        {...form.register('device_browser')}
                      />
                    </Field>
                  </div>
                </details>
                <Field
                  label="Requested urgency"
                  error={form.formState.errors.requested_urgency?.message}
                  hint="Your requested urgency helps us understand the impact. The developer sets priority after review; it does not promise an immediate response."
                >
                  <select {...form.register('requested_urgency')}>
                    {PRIORITIES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <FilePicker
                  files={files}
                  onChange={setFiles}
                  disabled={form.formState.isSubmitting}
                />
                <div className="form-actions">
                  <Link className="btn gray" to="/tickets">
                    Cancel
                  </Link>
                  <button className="btn green" disabled={form.formState.isSubmitting}>
                    <Send size={17} />
                    {form.formState.isSubmitting ? 'Submitting…' : 'Submit Ticket'}
                  </button>
                </div>
              </form>
            )}
          </section>
          <aside className="panel form-guide">
            <span className="eyebrow">A HELPFUL REPORT</span>
            <h2>Give us the full picture.</h2>
            <p>Clear details help your developer understand and resolve the issue sooner.</p>
            <ol>
              <li>Choose the project this request belongs to.</li>
              <li>Describe the issue and how it affects your work.</li>
              <li>Include screenshots or a PDF when helpful.</li>
              <li>Follow progress and reply to questions in your ticket.</li>
            </ol>
            <Notice>
              Remove passwords, API keys and sensitive personal information from your descriptions
              and files.
            </Notice>
          </aside>
        </div>
      )}
    </>
  )
}
