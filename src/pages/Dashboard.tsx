import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  CircleDot,
  Clock3,
  FolderKanban,
  MessageCircle,
  Plus,
  Search,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Ticket, TicketEvent } from '../lib/types'
import { formatDate } from '../lib/validation'
import { Empty, ErrorBox, PageTitle, Spinner } from '../components/ui'
import { TicketTable } from '../components/TicketTable'
export function Dashboard() {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const statuses = ['Open', 'In Progress', 'Waiting for Client', 'Resolved']
      const counts = await Promise.all(
        statuses.map(async (status) => {
          const { count, error } = await supabase
            .from('tickets')
            .select('id', { count: 'exact', head: true })
            .eq('status', status)
          if (error) throw error
          return count ?? 0
        }),
      )
      const [tickets, events, projects] = await Promise.all([
        supabase
          .from('tickets')
          .select('*,projects(name)')
          .order('updated_at', { ascending: false })
          .limit(5),
        supabase
          .from('ticket_events')
          .select('*,tickets(reference,title)')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .eq('archived', false),
      ])
      for (const result of [tickets, events, projects]) if (result.error) throw result.error
      return {
        counts,
        tickets: tickets.data as Ticket[],
        events: events.data as TicketEvent[],
        projects: projects.count ?? 0,
      }
    },
    refetchInterval: 30000,
  })
  return (
    <>
      <PageTitle
        eyebrow={admin ? 'DEVELOPER OVERVIEW' : 'CLIENT OVERVIEW'}
        title={`Hello, ${profile?.display_name.split(' ')[0]}.`}
        description={
          admin
            ? 'Here’s what’s happening across your client projects.'
            : 'Your projects, support requests, and updates. All in one place.'
        }
        action={
          <Link className="btn green" to="/tickets/new">
            <Plus size={18} />
            Submit Ticket
          </Link>
        }
      />
      <div className="welcome-banner">
        <div className="banner-icon">
          <FolderKanban size={27} />
        </div>
        <div>
          <strong>Good work starts with a clear conversation.</strong>
          <p>
            {admin
              ? 'Stay on top of requests and keep your clients in the loop.'
              : 'Found a bug or have an idea? Your developer is a ticket away.'}
          </p>
        </div>
        <Link to="/projects">
          View projects
          <ArrowUpRight size={17} />
        </Link>
      </div>
      {query.isPending ? (
        <Spinner />
      ) : query.error ? (
        <ErrorBox error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="stats-grid">
            {[
              {
                name: 'Open tickets',
                icon: CircleDot,
                color: 'blue',
                help: 'Ready for review',
                status: 'Open',
              },
              {
                name: 'In progress',
                icon: Clock3,
                color: 'orange',
                help: 'Work is underway',
                status: 'In Progress',
              },
              {
                name: 'Waiting for client',
                icon: MessageCircle,
                color: 'purple',
                help: 'A response is needed',
                status: 'Waiting for Client',
              },
              {
                name: 'Resolved',
                icon: CheckCheck,
                color: 'green',
                help: 'Ready to confirm',
                status: 'Resolved',
              },
            ].map(({ name, icon: Icon, color, help, status }, i) => (
              <Link
                to={`/tickets?status=${encodeURIComponent(status)}`}
                className="stat-card"
                key={name}
              >
                <div className="stat-top">
                  <span>{name}</span>
                  <span className={`stat-icon ${color}`}>
                    <Icon size={19} />
                  </span>
                </div>
                <strong>{query.data.counts[i].toString().padStart(2, '0')}</strong>
                <small>
                  {help}
                  <ArrowUpRight size={14} />
                </small>
              </Link>
            ))}
          </div>
          <div className="dashboard-grid">
            <section className="panel recent-tickets">
              <div className="section-heading">
                <div>
                  <h2>Recent tickets</h2>
                  <p>The latest from your support workspace.</p>
                </div>
                <Link className="text-link" to="/tickets">
                  View all
                  <ArrowRight size={16} />
                </Link>
              </div>
              <form
                className="dashboard-search"
                onSubmit={(e) => {
                  e.preventDefault()
                  navigate(`/tickets?q=${encodeURIComponent(search)}`)
                }}
              >
                <Search size={18} />
                <input
                  aria-label="Search tickets"
                  placeholder="Search by title or ticket reference…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className="btn blue small">Search</button>
              </form>
              <TicketTable tickets={query.data.tickets} />
            </section>
            <section className="panel activity-panel">
              <div className="section-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>A little progress, every day.</p>
                </div>
                <span className="live-dot" />
              </div>
              {query.data.events.length ? (
                <div className="activity-list">
                  {query.data.events.map((event) => (
                    <Link
                      className="activity-row"
                      key={event.id}
                      to={`/tickets/${event.ticket_id}`}
                    >
                      <div
                        className={`activity-icon ${event.kind === 'created' ? 'blue' : 'green'}`}
                      >
                        {event.kind === 'created' ? <Plus size={15} /> : <CheckCheck size={15} />}
                      </div>
                      <div>
                        <p>
                          <strong>{event.actor_name}</strong>{' '}
                          {event.kind === 'created'
                            ? 'submitted a ticket'
                            : event.kind === 'reply_added'
                              ? 'sent a reply'
                              : event.kind === 'priority_changed'
                                ? 'updated priority'
                                : `changed status to ${event.detail.to}`}
                        </p>
                        <span>
                          {event.tickets?.reference} · {event.tickets?.title}
                        </span>
                        <small>{formatDate(event.created_at)}</small>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty title="All quiet for now">
                  Updates will appear as your projects move forward.
                </Empty>
              )}
              <div className="activity-footer">
                <FolderKanban size={17} />
                {query.data.projects} active project{query.data.projects !== 1 ? 's' : ''}
                <Link to="/projects" aria-label="View projects">
                  <ArrowRight size={17} />
                </Link>
              </div>
            </section>
          </div>
          <div className="help-strip">
            <span className="help-icon">
              <MessageCircle size={21} />
            </span>
            <div>
              <strong>Everything has a place.</strong>
              <p>
                Bug reports, feature requests, questions — keep the conversation connected to your
                project.
              </p>
            </div>
            <Link to="/tickets/new">
              Start a conversation
              <ArrowRight size={16} />
            </Link>
          </div>
        </>
      )}
    </>
  )
}
