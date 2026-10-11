import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { edge, rpc } from '../lib/api'
import { allRows } from '../lib/queries'
import type { AdminMembership, Client, Profile } from '../lib/types'
import { Badge, ErrorBox, Field, Notice, PageTitle, Spinner, Success } from '../components/ui'

export default function Administrators() {
  const cache = useQueryClient()
  const [operation, setOperation] = useState('convert')
  const [userId, setUserId] = useState('')
  const [clientId, setClientId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [success, setSuccess] = useState('')
  const query = useQuery({
    queryKey: ['administrator-management'],
    queryFn: async () => {
      const [clients, profiles, memberships, operators] = await Promise.all([
        allRows<Client>('clients'),
        allRows<Profile>('profiles', 'display_name'),
        allRows<AdminMembership>('admin_client_memberships', 'created_at'),
        allRows<{ user_id: string; active: boolean }>('platform_operators', 'created_at'),
      ])
      return { clients, profiles, memberships, operators }
    },
  })
  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError(null)
    setSuccess('')
    try {
      await action()
      await cache.invalidateQueries()
      setSuccess(message)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  if (query.isPending) return <Spinner />
  if (query.error) return <ErrorBox error={query.error} retry={() => void query.refetch()} />
  const { clients, profiles, memberships, operators } = query.data
  const platformIds = new Set(operators.filter((o) => o.active).map((o) => o.user_id))
  const admins = profiles.filter((p) => p.role === 'admin' && !platformIds.has(p.id))
  const choices = profiles.filter(
    (p) =>
      p.active &&
      !platformIds.has(p.id) &&
      (operation === 'assign' ? p.role === 'admin' : p.role === 'client'),
  )
  return (
    <>
      <PageTitle
        title="Administrator Management"
        description="Assign administrators to explicit business accounts."
      />
      <Notice>
        Converting an existing account preserves its sign-in details and history, archives its old
        client memberships and replaces its active administrator assignments with the selected
        business. Ordinary administrators cannot use these controls.
      </Notice>
      {Boolean(error) && <ErrorBox error={error} />}
      {success && <Success>{success}</Success>}
      <section className="panel panel-padding">
        <h2>Administrator access</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void mutate(
              async () => {
                if (operation === 'assign') {
                  await rpc('set_admin_membership', {
                    p_client: clientId,
                    p_user: userId,
                    p_active: true,
                  })
                } else {
                  await edge(
                    'admin-users',
                    operation === 'invite'
                      ? { action: 'invite_administrator', client_id: clientId, name, email }
                      : { action: 'convert_administrator', client_id: clientId, user_id: userId },
                  )
                }
              },
              operation === 'invite'
                ? 'Administrator invitation/assignment completed.'
                : 'Administrator access updated.',
            )
          }}
        >
          <Field label="Operation">
            <select
              value={operation}
              onChange={(e) => {
                setOperation(e.target.value)
                setUserId('')
              }}
            >
              <option value="convert">Convert an existing client user</option>
              <option value="invite">Invite or convert by email</option>
              <option value="assign">Add an administrator assignment</option>
            </select>
          </Field>
          {operation === 'invite' ? (
            <div className="form-grid">
              <Field label="Administrator name">
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Administrator email">
                <input
                  required
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
          ) : (
            <Field label="Existing account">
              <select required value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Select an account</option>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name} · {p.email}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Administrator business assignment">
            <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a business</option>
              {clients
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <button className="btn green" disabled={busy}>
            {operation === 'convert'
              ? 'Convert Existing Account'
              : operation === 'invite'
                ? 'Invite Administrator'
                : 'Assign Administrator'}
          </button>
        </form>
      </section>
      <section className="panel panel-padding">
        <h2>Business assignments</h2>
        {memberships.length === 0 && <p>No administrator assignments yet.</p>}
        {memberships.map((m) => (
          <div className="member-row" key={`${m.user_id}:${m.client_id}`}>
            <div>
              <strong>
                {profiles.find((p) => p.id === m.user_id)?.display_name ?? 'Administrator'}
              </strong>
              <small>{clients.find((c) => c.id === m.client_id)?.name ?? 'Business account'}</small>
              <Badge value={m.active ? 'Active' : 'Unassigned'} />
            </div>
            <button
              className="btn gray small"
              disabled={busy}
              onClick={() =>
                void mutate(
                  () =>
                    rpc('set_admin_membership', {
                      p_client: m.client_id,
                      p_user: m.user_id,
                      p_active: !m.active,
                    }),
                  'Business assignment updated.',
                )
              }
            >
              {m.active ? 'Remove Administrator Assignment' : 'Restore Administrator Assignment'}
            </button>
          </div>
        ))}
      </section>
      <section className="panel panel-padding">
        <h2>Administrator accounts</h2>
        {admins.map((p) => (
          <div className="member-row" key={p.id}>
            <div>
              <strong>{p.display_name}</strong>
              <small>{p.email}</small>
              <Badge value={p.active ? 'Active' : 'Disabled'} />
            </div>
            <button
              className="btn gray small"
              disabled={busy}
              onClick={() =>
                void mutate(
                  () => rpc('set_user_active', { p_user: p.id, p_active: !p.active }),
                  'Administrator account access updated.',
                )
              }
            >
              {p.active ? 'Disable Administrator' : 'Enable Administrator'}
            </button>
          </div>
        ))}
      </section>
    </>
  )
}
