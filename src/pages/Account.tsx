import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Bell, CheckCheck, LockKeyhole, Save, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { edge, rpc } from '../lib/api'
import { formatDate } from '../lib/validation'
import type { Notification } from '../lib/types'
import {
  Empty,
  ErrorBox,
  Field,
  Notice,
  PageTitle,
  Pagination,
  Spinner,
  Success,
} from '../components/ui'

export function Notifications() {
  const cache = useQueryClient()
  const [page, setPage] = useState(1)
  const [unread, setUnread] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const query = useQuery({
    queryKey: ['notifications', page, unread],
    queryFn: async () => {
      let q = supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * 12, page * 12 - 1)
      if (unread) q = q.is('read_at', null)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as Notification[], count: count ?? 0 }
    },
    refetchInterval: 30000,
  })
  async function mark(id?: string) {
    setBusy(true)
    setError(null)
    try {
      let q = supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .is('read_at', null)
      if (id) q = q.eq('id', id)
      const { error } = await q
      if (error) throw error
      await cache.invalidateQueries()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageTitle
        title="Notifications"
        description="Stay connected to every update that matters."
        action={
          <button className="btn orange" disabled={busy} onClick={() => void mark()}>
            <CheckCheck size={17} />
            Mark All Read
          </button>
        }
      />
      {Boolean(error) && <ErrorBox error={error} />}
      <label className="checkbox notification-filter">
        <input
          type="checkbox"
          checked={unread}
          onChange={(e) => {
            setUnread(e.target.checked)
            setPage(1)
          }}
        />
        Show unread only
      </label>
      <section className="panel">
        {query.isPending ? (
          <Spinner />
        ) : query.error ? (
          <ErrorBox error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            {query.data.rows.length ? (
              query.data.rows.map((n) => (
                <article className={`notification-row ${n.read_at ? '' : 'unread'}`} key={n.id}>
                  <span className="notification-icon">
                    <Bell size={19} />
                  </span>
                  <Link
                    to={`/tickets/${n.ticket_id}`}
                    onClick={() => {
                      if (!n.read_at) void mark(n.id)
                    }}
                  >
                    <strong>{n.title}</strong>
                    <time>{formatDate(n.created_at)}</time>
                  </Link>
                  {!n.read_at && (
                    <button
                      className="btn gray small"
                      disabled={busy}
                      onClick={() => void mark(n.id)}
                    >
                      <CheckCheck size={15} />
                      Mark Read
                    </button>
                  )}
                </article>
              ))
            ) : (
              <Empty title="You’re all caught up">
                New tickets, replies and status updates will appear here.
              </Empty>
            )}
            <Pagination page={page} count={query.data.count} onChange={setPage} />
          </>
        )}
      </section>
    </>
  )
}
const profileSchema = z.object({ display_name: z.string().trim().min(1).max(120) })
export function Settings() {
  const { profile, refresh } = useAuth()
  const [error, setError] = useState<unknown>(null)
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: profile?.display_name ?? '' },
  })
  return (
    <>
      <PageTitle
        title="Profile & Settings"
        description="Your account details and workspace preferences."
      />
      <div className="settings-grid">
        <section className="panel form-panel">
          <h2>Personal details</h2>
          {Boolean(error) && <ErrorBox error={error} />} {success && <Success>{success}</Success>}
          <form
            onSubmit={form.handleSubmit(async (v) => {
              setError(null)
              setSuccess('')
              try {
                await rpc('save_profile', { p_name: v.display_name })
                await refresh()
                setSuccess('Profile updated.')
              } catch (e) {
                setError(e)
              }
            })}
          >
            <Field label="Display name" error={form.formState.errors.display_name?.message}>
              <input {...form.register('display_name')} />
            </Field>
            <Field
              label="Email address"
              hint="Contact your developer to change your sign-in email."
            >
              <input value={profile?.email ?? ''} readOnly />
            </Field>
            <Field label="Account role">
              <input readOnly value={profile?.role === 'admin' ? 'Developer / Admin' : 'Client'} />
            </Field>
            <Field label="Display timezone">
              <input readOnly value="Asia/Manila (UTC+8)" />
            </Field>
            <div className="form-actions">
              <button className="btn orange" disabled={form.formState.isSubmitting}>
                <Save size={17} />
                Save Changes
              </button>
            </div>
          </form>
        </section>
        <div>
          <section className="panel panel-padding">
            <h2>
              <LockKeyhole size={19} />
              Account security
            </h2>
            <p>
              Use a unique password. Password changes are completed through a secure email link.
            </p>
            <Link className="btn blue" to="/forgot-password">
              Reset Password
            </Link>
          </section>
          <section className="panel panel-padding">
            <h2>Notifications</h2>
            <p>
              Ticket updates appear in your in-app notifications. Invitation and password reset
              emails are sent to your account address.
            </p>
            <Link className="text-link" to="/notifications">
              View Notifications
            </Link>
          </section>
          {profile?.role === 'admin' && (
            <section className="panel panel-padding">
              <h2>Storage maintenance</h2>
              <p>
                Remove abandoned attachment reservations older than 24 hours. Saved ticket
                attachments are preserved.
              </p>
              <Notice>
                Run daily. Each sweep processes up to 100 pending uploads; repeat if more remain.
              </Notice>
              <button
                className="btn red"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  setSuccess('')
                  try {
                    const result = await edge<{ removed: number; more_possible: boolean }>(
                      'files',
                      { action: 'cleanup' },
                    )
                    setSuccess(
                      `${result.removed} abandoned uploads removed.${result.more_possible ? ' Run cleanup again to process remaining uploads.' : ''}`,
                    )
                  } catch (e) {
                    setError(e)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Trash2 size={16} />
                Clean Abandoned Uploads
              </button>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
