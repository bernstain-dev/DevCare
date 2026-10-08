import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { Ticket } from '../lib/types'
import { formatDate } from '../lib/validation'
import { Badge, Empty } from './ui'
export function TicketTable({ tickets }: { tickets: Ticket[] }) {
  if (!tickets.length)
    return <Empty title="No tickets here yet">Your project conversations will appear here.</Empty>
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Project</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Last updated</th>
            <th>
              <span className="sr-only">View</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td>
                <Link className="ticket-title" to={`/tickets/${t.id}`}>
                  <span className="reference">{t.reference}</span>
                  <strong>{t.title}</strong>
                  <small>{t.request_type}</small>
                </Link>
              </td>
              <td>{t.projects?.name ?? 'Project'}</td>
              <td>
                <Badge value={t.status} />
              </td>
              <td>
                <span className={`priority-dot ${t.priority.toLowerCase()}`} />
                {t.priority}
              </td>
              <td className="date-cell">{formatDate(t.updated_at)}</td>
              <td>
                <Link
                  className="icon-btn blue-text"
                  to={`/tickets/${t.id}`}
                  aria-label={`View ${t.reference}`}
                >
                  <ArrowUpRight size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
