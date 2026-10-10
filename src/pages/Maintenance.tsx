import { useEffect } from 'react'
import { RefreshCw, Wrench } from 'lucide-react'
import type { MaintenanceConfig } from '../lib/maintenance'
import { Brand } from '../components/Brand'

export function MaintenancePage({
  config,
  checking,
  retry,
}: {
  config?: MaintenanceConfig
  checking: boolean
  retry: () => void
}) {
  useEffect(() => {
    document.title = 'Maintenance | DevCare — Client Support Portal'
  }, [])

  return (
    <div className="maintenance-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="maintenance-header">
        <Brand label="DevCare home" />
        <span className="maintenance-status">
          {config ? 'Maintenance in progress' : 'Portal unavailable'}
        </span>
      </header>
      <main id="main-content" className="maintenance-main">
        <section className="maintenance-card" aria-labelledby="maintenance-title">
          <div className="maintenance-icon">
            <Wrench size={32} aria-hidden="true" />
          </div>
          <p className="eyebrow">A LITTLE TIME FOR AN UPDATE</p>
          <h1 id="maintenance-title">{config?.title ?? 'DevCare is temporarily unavailable.'}</h1>
          <p className="maintenance-message">
            {config?.message ??
              "We couldn't confirm the portal's availability. Please try again shortly."}
          </p>
          <div className="maintenance-details">
            <h2>We’ll be back soon.</h2>
            <p>
              Sign-in, projects and tickets will be available again when maintenance is complete.
            </p>
          </div>
          <button className="btn green" onClick={retry} disabled={checking}>
            <RefreshCw size={17} aria-hidden="true" />
            {checking ? 'Checking availability…' : 'Check again'}
          </button>
          <p className="maintenance-check" role="status">
            {checking ? 'Checking for an update…' : 'This page checks for updates every minute.'}
          </p>
        </section>
      </main>
      <footer className="maintenance-footer">DevCare · Made for better collaboration.</footer>
    </div>
  )
}
