import { useRef, useState, useSyncExternalStore } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bell,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Ticket,
  Users,
  X,
  ArrowUpRight,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { ErrorBox } from './ui'
import { Brand } from './Brand'

const mediaQuery = '(max-width: 950px)'
function subscribeMobile(callback: () => void) {
  const media = window.matchMedia(mediaQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
const isMobile = () => window.matchMedia(mediaQuery).matches

export function Layout() {
  const { profile, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const mobile = useSyncExternalStore(subscribeMobile, isMobile)
  const compactSidebar = collapsed && !mobile
  const menu = useRef<HTMLButtonElement>(null)
  const closeNavigation = () => {
    setOpen(false)
    requestAnimationFrame(() => menu.current?.focus())
  }
  const [error, setError] = useState<unknown>(null)
  const admin = profile?.role === 'admin'
  const { data: unread = 0 } = useQuery({
    queryKey: ['unread'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
    refetchInterval: 30000,
  })
  const links = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/projects', label: admin ? 'Projects' : 'My Projects', icon: FolderKanban },
    ...(admin ? [{ to: '/clients', label: 'Clients', icon: Users }] : []),
    { to: '/tickets', label: admin ? 'All Tickets' : 'My Tickets', icon: Ticket },
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/settings', label: 'Profile & Settings', icon: Settings },
  ]
  return (
    <div
      className={`app-layout ${compactSidebar ? 'sidebar-collapsed' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) closeNavigation()
      }}
    >
      {open && (
        <button className="nav-overlay" aria-label="Close navigation" onClick={closeNavigation} />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar ${open ? 'open' : ''}`}
        inert={mobile && !open}
      >
        <Brand
          variant={compactSidebar || mobile ? 'icon' : 'full'}
          showName={mobile}
          className={compactSidebar || mobile ? 'sidebar-compact-brand' : 'brand-light-panel'}
          onClick={() => setOpen(false)}
        />
        <button
          className="mobile-close icon-btn"
          aria-label="Close navigation"
          onClick={closeNavigation}
        >
          <X />
        </button>
        <div className="workspace-heading">
          {!compactSidebar && (
            <div className="workspace-label">
              {admin ? 'DEVELOPER WORKSPACE' : 'CLIENT WORKSPACE'}
            </div>
          )}
          {!mobile && (
            <button
              className="icon-btn sidebar-toggle"
              aria-label={compactSidebar ? 'Expand sidebar' : 'Collapse sidebar'}
              title={compactSidebar ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!compactSidebar}
              aria-controls="workspace-sidebar"
              onClick={() => setCollapsed((value) => !value)}
            >
              {compactSidebar ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          )}
        </div>
        <nav aria-label="Main navigation">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              aria-label={label}
              title={compactSidebar ? label : undefined}
              onClick={() => setOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={19} />
              <span className={compactSidebar ? 'sr-only' : 'nav-label'}>{label}</span>
              {to === '/notifications' && unread > 0 && <span className="nav-count">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!compactSidebar && (
            <div className="support-note">
              <span className="availability-dot" />
              <strong>A little clarity goes a long way.</strong>
              <p>Keep project updates and conversations in one place.</p>
              <Link to="/tickets/new" onClick={() => setOpen(false)}>
                Submit a ticket
                <ArrowUpRight size={16} />
              </Link>
            </div>
          )}
          <div className="sidebar-profile">
            <span className="avatar" title={profile?.display_name}>
              {profile?.display_name.slice(0, 2).toUpperCase()}
            </span>
            {!compactSidebar && (
              <div>
                <strong>{profile?.display_name}</strong>
                <small>{admin ? 'Developer / Admin' : 'Client account'}</small>
              </div>
            )}
            <button
              className="icon-btn"
              aria-label="Log out"
              onClick={async () => {
                try {
                  await logout()
                  navigate('/login')
                } catch (e) {
                  setError(e)
                }
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-area" inert={mobile && open}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              ref={menu}
              className="icon-btn menu-btn"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <span className="portal-label">CLIENT SUPPORT PORTAL</span>
            <Brand variant="icon" showName className="mobile-header-brand" />
            <span className="topbar-divider" />
            <span className="muted">A clearer way to work together.</span>
          </div>
          <div className="topbar-right">
            <Link
              className="icon-btn notification-bell"
              to="/notifications"
              aria-label={`${unread} unread notifications`}
            >
              <Bell size={20} />
              {unread > 0 && <span />}
            </Link>
            <span className="topbar-avatar">{profile?.display_name.slice(0, 2).toUpperCase()}</span>
          </div>
        </header>
        <main id="main-content" className="page-content">
          {Boolean(error) && <ErrorBox error={error} />}
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>DevCare · Made for better collaboration.</span>
          <span>All times in Asia/Manila (UTC+8)</span>
        </footer>
      </div>
    </div>
  )
}
