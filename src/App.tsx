import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { CodeXml, LogOut } from 'lucide-react'
import { useAuth } from './auth/AuthProvider'
import { configured } from './lib/supabase'
import { Layout } from './components/Layout'
import { ErrorBox, Spinner } from './components/ui'
import { AuthPage, SetupPage } from './pages/AuthPages'
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Projects = lazy(() => import('./pages/Projects').then((m) => ({ default: m.Projects })))
const ProjectDetails = lazy(() =>
  import('./pages/Projects').then((m) => ({ default: m.ProjectDetails })),
)
const Clients = lazy(() => import('./pages/Clients').then((m) => ({ default: m.Clients })))
const Tickets = lazy(() => import('./pages/Tickets').then((m) => ({ default: m.Tickets })))
const SubmitTicket = lazy(() =>
  import('./pages/Tickets').then((m) => ({ default: m.SubmitTicket })),
)
const TicketDetails = lazy(() =>
  import('./pages/TicketDetails').then((m) => ({ default: m.TicketDetails })),
)
const Notifications = lazy(() =>
  import('./pages/Account').then((m) => ({ default: m.Notifications })),
)
const Settings = lazy(() => import('./pages/Account').then((m) => ({ default: m.Settings })))

function Guard() {
  const { session, profile, loading, error, refresh, logout } = useAuth()
  if (!configured) return <SetupPage />
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (error || !profile)
    return (
      <div className="setup">
        <ErrorBox error={error ?? 'Profile unavailable'} retry={() => void refresh()} />
        <button className="btn gray" onClick={() => void logout()}>
          Log Out
        </button>
      </div>
    )
  if (!profile.active)
    return (
      <div className="setup">
        <CodeXml size={36} />
        <h1>Your access is disabled.</h1>
        <p>Contact your developer to restore access.</p>
        <button className="btn gray" onClick={() => void logout()}>
          <LogOut size={17} />
          Log Out
        </button>
      </div>
    )
  return <Layout />
}
function AdminOnly() {
  const { profile } = useAuth()
  return profile?.role === 'admin' ? <Clients /> : <Navigate to="/" replace />
}
export function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
          <Route path="/reset-password" element={<AuthPage mode="reset" />} />
          <Route path="/accept-invitation" element={<AuthPage mode="invite" />} />
          <Route element={<Guard />}>
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetails />} />
            <Route path="clients" element={<AdminOnly />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/new" element={<SubmitTicket />} />
            <Route path="tickets/:id" element={<TicketDetails />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<Settings />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>Page not found</h1>
                  <a className="btn blue" href="/">
                    Back to Dashboard
                  </a>
                </div>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}
