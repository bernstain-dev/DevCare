import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Archive,
  ArrowUpRight,
  ExternalLink,
  FolderKanban,
  Pencil,
  Plus,
  Save,
  Search,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { useClients } from '../lib/queries'
import { projectSchema, formatDate } from '../lib/validation'
import type { Project, Ticket } from '../lib/types'
import {
  Empty,
  ErrorBox,
  Field,
  Modal,
  Notice,
  PageTitle,
  Pagination,
  Spinner,
} from '../components/ui'
import { TicketTable } from '../components/TicketTable'

function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const cache = useQueryClient()
  const clients = useClients()
  const [error, setError] = useState<unknown>(null)
  const form = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: project
      ? {
          ...project,
          application_url: project.application_url ?? '',
          current_version: project.current_version ?? '',
        }
      : {
          name: '',
          client_id: '',
          description: '',
          application_url: '',
          current_version: '',
          support_notes: '',
          archived: false,
        },
  })
  return (
    <Modal title={project ? 'Edit Project' : 'Add Project'} onClose={onClose}>
      {clients.isPending ? (
        <Spinner />
      ) : clients.error ? (
        <ErrorBox error={clients.error} />
      ) : (
        <form
          onSubmit={form.handleSubmit(async (v) => {
            try {
              setError(null)
              await rpc('save_project', {
                p_id: project?.id ?? null,
                p_client: v.client_id,
                p_name: v.name,
                p_description: v.description,
                p_url: v.application_url,
                p_version: v.current_version,
                p_notes: v.support_notes,
                p_archived: v.archived,
              })
              await cache.invalidateQueries()
              onClose()
            } catch (e) {
              setError(e)
            }
          })}
        >
          {Boolean(error) && <ErrorBox error={error} />}
          <Field label="Project name" error={form.formState.errors.name?.message}>
            <input {...form.register('name')} autoFocus />
          </Field>
          <Field
            label="Client account"
            error={form.formState.errors.client_id?.message}
            hint={
              project ? 'Client assignment is permanent to preserve ticket ownership.' : undefined
            }
          >
            <select {...form.register('client_id')} disabled={Boolean(project)}>
              <option value="">Select a client</option>
              {clients.data
                .filter((c) => c.active || c.id === project?.client_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Description" error={form.formState.errors.description?.message}>
            <textarea rows={3} {...form.register('description')} />
          </Field>
          <div className="form-grid">
            <Field
              label="Application URL (optional)"
              error={form.formState.errors.application_url?.message}
            >
              <input type="url" placeholder="https://…" {...form.register('application_url')} />
            </Field>
            <Field
              label="Current version (optional)"
              error={form.formState.errors.current_version?.message}
            >
              <input {...form.register('current_version')} />
            </Field>
          </div>
          <Field
            label="Support notes"
            hint="Visible to assigned clients."
            error={form.formState.errors.support_notes?.message}
          >
            <textarea rows={3} {...form.register('support_notes')} />
          </Field>
          <label className="checkbox">
            <input type="checkbox" {...form.register('archived')} />
            Archived — readable, with new tickets disabled
          </label>
          <div className="form-actions">
            <button type="button" className="btn gray" onClick={onClose}>
              Cancel
            </button>
            <button
              className={`btn ${project ? 'orange' : 'green'}`}
              disabled={form.formState.isSubmitting}
            >
              <Save size={17} />
              {project ? 'Save Changes' : 'Add Project'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
export function Projects() {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const [edit, setEdit] = useState<Project | null | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('active')
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['projects', search, state, page],
    queryFn: async () => {
      let q = supabase
        .from('projects')
        .select('*,clients(name)', { count: 'exact' })
        .order('name')
        .range((page - 1) * 12, page * 12 - 1)
      if (search) q = q.ilike('name', `%${search}%`)
      if (state !== 'all') q = q.eq('archived', state === 'archived')
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as (Project & { clients: { name: string } })[], count: count ?? 0 }
    },
  })
  return (
    <>
      <PageTitle
        title={admin ? 'Projects' : 'My Projects'}
        description="Every project, with its support history close at hand."
        action={
          admin && (
            <button className="btn green" onClick={() => setEdit(null)}>
              <Plus size={18} />
              Add Project
            </button>
          )
        }
      />
      <div className="filter-bar">
        <Field label="Search projects">
          <div className="input-icon">
            <Search size={18} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Project name…"
            />
          </div>
        </Field>
        <Field label="Project state">
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value)
              setPage(1)
            }}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All projects</option>
          </select>
        </Field>
      </div>
      {query.isPending ? (
        <Spinner />
      ) : query.error ? (
        <ErrorBox error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.rows.length ? (
            <div className="project-grid">
              {query.data.rows.map((p) => (
                <article className="panel project-card" key={p.id}>
                  <div className="project-card-top">
                    <span className="project-icon">
                      <FolderKanban size={24} />
                    </span>
                    <span className={`badge ${p.archived ? 'closed' : 'resolved'}`}>
                      {p.archived ? 'Archived' : 'Active'}
                    </span>
                  </div>
                  <span className="eyebrow">{p.clients?.name}</span>
                  <h2>
                    <Link to={`/projects/${p.id}`}>{p.name}</Link>
                  </h2>
                  <p>{p.description || 'No description added yet.'}</p>
                  <div className="project-meta">
                    <span>Version {p.current_version ?? 'not specified'}</span>
                    {p.application_url && (
                      <a
                        href={p.application_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${p.name} application`}
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                  <div className="card-actions">
                    <Link className="text-link" to={`/projects/${p.id}`}>
                      View Project
                      <ArrowUpRight size={17} />
                    </Link>
                    {admin && (
                      <button className="btn orange small" onClick={() => setEdit(p)}>
                        <Pencil size={14} />
                        Edit
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty title="No projects found">
              {admin
                ? 'Add a project and assign it to a client account.'
                : 'Your developer will assign projects to your account.'}
            </Empty>
          )}
          <Pagination page={page} count={query.data.count} onChange={setPage} />
        </>
      )}
      {edit !== undefined && (
        <ProjectForm project={edit ?? undefined} onClose={() => setEdit(undefined)} />
      )}
    </>
  )
}
export function ProjectDetails() {
  const { id } = useParams()
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const cache = useQueryClient()
  const [edit, setEdit] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const query = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const result = await supabase
        .from('projects')
        .select('*,clients(name)')
        .eq('id', id!)
        .single()
      if (result.error) throw new Error('Project unavailable or access disabled.')
      const tickets = await supabase
        .from('tickets')
        .select('*,projects(name)')
        .eq('project_id', id!)
        .order('updated_at', { ascending: false })
        .limit(8)
      if (tickets.error) throw tickets.error
      return {
        project: result.data as Project & { clients: { name: string } },
        tickets: tickets.data as Ticket[],
      }
    },
  })
  if (query.isPending) return <Spinner />
  if (query.error) return <ErrorBox error={query.error} retry={() => void query.refetch()} />
  const p = query.data.project
  return (
    <>
      <Link className="back-link" to="/projects">
        ← All projects
      </Link>
      <PageTitle
        eyebrow={p.clients.name}
        title={p.name}
        description={p.description || 'Project support workspace.'}
        action={
          <div className="button-row">
            {admin && (
              <button className="btn orange" onClick={() => setEdit(true)}>
                <Pencil size={17} />
                Edit Project
              </button>
            )}
            {!p.archived && (
              <Link className="btn green" to={`/tickets/new?project=${p.id}`}>
                <Plus size={18} />
                Submit Ticket
              </Link>
            )}
          </div>
        }
      />
      {Boolean(error) && <ErrorBox error={error} />}{' '}
      {p.archived && (
        <Notice>
          This project is archived. Its ticket history remains available, and new ticket submission
          is disabled.
        </Notice>
      )}
      <section className="panel details-panel">
        <div className="detail-grid">
          <div>
            <span>Current version</span>
            <strong>{p.current_version ?? 'Not specified'}</strong>
          </div>
          <div>
            <span>State</span>
            <strong>{p.archived ? 'Archived' : 'Active'}</strong>
          </div>
          <div>
            <span>Added</span>
            <strong>{formatDate(p.created_at)}</strong>
          </div>
          <div>
            <span>Application</span>
            {p.application_url ? (
              <a className="text-link" href={p.application_url} target="_blank" rel="noreferrer">
                Open Application
                <ExternalLink size={15} />
              </a>
            ) : (
              <strong>No URL provided</strong>
            )}
          </div>
        </div>
        <h3>Support notes</h3>
        <p className="preserve-text">{p.support_notes || 'No support notes added.'}</p>
        {admin && !p.archived && (
          <button
            disabled={busy}
            className="btn red"
            onClick={async () => {
              setBusy(true)
              try {
                await rpc('save_project', {
                  p_id: p.id,
                  p_client: p.client_id,
                  p_name: p.name,
                  p_description: p.description,
                  p_url: p.application_url ?? '',
                  p_version: p.current_version ?? '',
                  p_notes: p.support_notes,
                  p_archived: true,
                })
                await cache.invalidateQueries()
              } catch (e) {
                setError(e)
              } finally {
                setBusy(false)
              }
            }}
          >
            <Archive size={17} />
            Archive Project
          </button>
        )}
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Recent project tickets</h2>
          <Link className="text-link" to={`/tickets?project=${p.id}`}>
            View all
            <ArrowUpRight size={17} />
          </Link>
        </div>
        <TicketTable tickets={query.data.tickets} />
      </section>
      {edit && <ProjectForm project={p} onClose={() => setEdit(false)} />}
    </>
  )
}
