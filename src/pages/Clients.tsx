import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MailPlus, Pencil, Plus, Save, ShieldOff, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { edge, rpc } from '../lib/api'
import { clientSchema } from '../lib/validation'
import type { Client, Membership, Profile } from '../lib/types'
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  Modal,
  Notice,
  PageTitle,
  Pagination,
  Spinner,
  Success,
} from '../components/ui'

function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const cache = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const form = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: client ?? { name: '', contact_email: '', description: '', active: true },
  })
  return (
    <Modal title={client ? 'Edit Client' : 'Add Client'} onClose={onClose}>
      <form
        onSubmit={form.handleSubmit(async (v) => {
          try {
            setError(null)
            await rpc('save_client', {
              p_id: client?.id ?? null,
              p_name: v.name,
              p_email: v.contact_email,
              p_description: v.description,
              p_active: v.active,
            })
            await cache.invalidateQueries()
            onClose()
          } catch (e) {
            setError(e)
          }
        })}
      >
        {Boolean(error) && <ErrorBox error={error} />}
        <Field label="Client / business name" error={form.formState.errors.name?.message}>
          <input autoFocus {...form.register('name')} />
        </Field>
        <Field
          label="Contact email (optional)"
          error={form.formState.errors.contact_email?.message}
        >
          <input type="email" {...form.register('contact_email')} />
        </Field>
        <Field label="Description" error={form.formState.errors.description?.message}>
          <textarea rows={4} {...form.register('description')} />
        </Field>
        <label className="checkbox">
          <input type="checkbox" {...form.register('active')} />
          Account access enabled
        </label>
        <Notice>
          Disabling a client account immediately blocks its members from its projects, tickets and
          files, including existing sessions. History is preserved.
        </Notice>
        <div className="form-actions">
          <button type="button" className="btn gray" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${client ? 'orange' : 'green'}`}
            disabled={form.formState.isSubmitting}
          >
            <Save size={17} />
            {client ? 'Save Changes' : 'Add Client'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
const inviteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
})
function Memberships({ client, onClose }: { client: Client; onClose: () => void }) {
  const cache = useQueryClient()
  const [error, setError] = useState<unknown>(null)
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(1)
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { name: '', email: '' },
  })
  const query = useQuery({
    queryKey: ['members', client.id, page],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('client_memberships')
        .select('*,profiles!client_memberships_user_id_fkey(*)', { count: 'exact' })
        .eq('client_id', client.id)
        .order('created_at')
        .range((page - 1) * 10, page * 10 - 1)
      if (error) throw error
      return { rows: data as (Membership & { profiles: Profile })[], count: count ?? 0 }
    },
  })
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await cache.invalidateQueries()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Manage Users · ${client.name}`} onClose={onClose}>
      {Boolean(error) && <ErrorBox error={error} />} {success && <Success>{success}</Success>}
      <Notice>
        A membership grants access to every project in this client account. Disabling a user blocks
        all their memberships; removing an assignment affects this account only.
      </Notice>
      {query.isPending ? (
        <Spinner />
      ) : query.error ? (
        <ErrorBox error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.rows.map((m) => (
            <div key={m.id} className="member-row">
              <div>
                <strong>{m.profiles.display_name}</strong>
                <small>{m.profiles.email}</small>
                <Badge
                  value={!m.profiles.active ? 'Disabled' : m.active ? 'Active' : 'Unassigned'}
                />
              </div>
              <div className="button-row">
                <button
                  disabled={busy}
                  className={`btn ${m.active ? 'red' : 'green'} small`}
                  onClick={() =>
                    void mutate(() =>
                      rpc('set_membership', {
                        p_client: client.id,
                        p_user: m.user_id,
                        p_active: !m.active,
                      }),
                    )
                  }
                >
                  <Users size={14} />
                  {m.active ? 'Remove Assignment' : 'Restore Assignment'}
                </button>
                <button
                  disabled={busy}
                  className={`btn ${m.profiles.active ? 'red' : 'green'} small`}
                  onClick={() =>
                    void mutate(() =>
                      rpc('set_user_active', { p_user: m.user_id, p_active: !m.profiles.active }),
                    )
                  }
                >
                  <ShieldOff size={14} />
                  {m.profiles.active ? 'Disable User' : 'Enable User'}
                </button>
              </div>
            </div>
          ))}
          {query.data.rows.length === 0 && <p className="muted">No users assigned yet.</p>}
          <Pagination page={page} count={query.data.count} size={10} onChange={setPage} />
        </>
      )}
      <h3>Invite or assign a user</h3>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          setError(null)
          setSuccess('')
          try {
            const result = await edge<{ message: string }>('admin-users', {
              ...values,
              client_id: client.id,
            })
            setSuccess(result.message)
            form.reset()
            await cache.invalidateQueries()
          } catch (e) {
            setError(e)
          }
        })}
      >
        <div className="form-grid">
          <Field label="Full name" error={form.formState.errors.name?.message}>
            <input {...form.register('name')} />
          </Field>
          <Field label="Email address" error={form.formState.errors.email?.message}>
            <input type="email" {...form.register('email')} />
          </Field>
        </div>
        <p className="muted">
          New users and users with an unaccepted invitation receive a fresh invitation email.
          Existing activated client users are assigned directly and keep their sign-in details.
        </p>
        <div className="form-actions">
          <button className="btn green" disabled={form.formState.isSubmitting || !client.active}>
            <MailPlus size={17} />
            Invite User
          </button>
        </div>
      </form>
    </Modal>
  )
}
export function Clients() {
  const [edit, setEdit] = useState<Client | null | undefined>(undefined)
  const [members, setMembers] = useState<Client | null>(null)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['clients', search, state, page],
    queryFn: async () => {
      let q = supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .order('name')
        .range((page - 1) * 12, page * 12 - 1)
      if (search) q = q.ilike('name', `%${search}%`)
      if (state !== 'all') q = q.eq('active', state === 'active')
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as Client[], count: count ?? 0 }
    },
  })
  return (
    <>
      <PageTitle
        title="Clients"
        description="Keep your client accounts and access organized."
        action={
          <button className="btn green" onClick={() => setEdit(null)}>
            <Plus size={18} />
            Add Client
          </button>
        }
      />
      <div className="filter-bar">
        <Field label="Search clients">
          <input
            placeholder="Client name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </Field>
        <Field label="Account state">
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value)
              setPage(1)
            }}
          >
            <option value="all">All accounts</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </Field>
      </div>
      {query.isPending ? (
        <Spinner />
      ) : query.error ? (
        <ErrorBox error={query.error} retry={() => void query.refetch()} />
      ) : (
        <section className="panel">
          {query.data.rows.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Client account</th>
                    <th>Contact</th>
                    <th>Access</th>
                    <th>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <p className="muted truncate">{c.description}</p>
                      </td>
                      <td>{c.contact_email || '—'}</td>
                      <td>
                        <Badge value={c.active ? 'Active' : 'Disabled'} />
                      </td>
                      <td>
                        <div className="button-row">
                          <button className="btn blue small" onClick={() => setMembers(c)}>
                            <Users size={15} />
                            Manage Users
                          </button>
                          <button className="btn orange small" onClick={() => setEdit(c)}>
                            <Pencil size={15} />
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No client accounts found">
              Add your first client to start assigning projects.
            </Empty>
          )}
          <Pagination page={page} count={query.data.count} onChange={setPage} />
        </section>
      )}
      {edit !== undefined && (
        <ClientForm client={edit ?? undefined} onClose={() => setEdit(undefined)} />
      )}{' '}
      {members && <Memberships client={members} onClose={() => setMembers(null)} />}
    </>
  )
}
