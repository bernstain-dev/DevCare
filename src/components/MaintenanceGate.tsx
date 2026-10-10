import { Suspense, lazy, useLayoutEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { loadMaintenance } from '../lib/maintenance'
import { MaintenancePage } from '../pages/Maintenance'
import { Spinner } from './ui'

// Keep Auth and Supabase initialization behind the availability check.
const Portal = lazy(() => import('../Portal'))

export function MaintenanceGate() {
  const container = useRef<HTMLDivElement>(null)
  const status = useQuery({
    queryKey: ['portal-availability'],
    queryFn: ({ signal }) => loadMaintenance(signal),
    retry: false,
    staleTime: 0,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  })
  const announcement = !status.isError && status.data?.mode === 'announcement'
  useLayoutEffect(() => {
    const root = container.current
    const banner = root?.querySelector('.maintenance-announcement')
    if (!root || !banner || !announcement) return
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--announcement-height', `${banner.getBoundingClientRect().height}px`)
    })
    observer.observe(banner)
    return () => observer.disconnect()
  }, [announcement])

  if (status.isPending)
    return (
      <main id="main-content" aria-label="Checking portal availability">
        <Spinner />
      </main>
    )

  if (status.isError || status.data.mode === 'maintenance')
    return (
      <MaintenancePage
        config={status.isError ? undefined : status.data}
        checking={status.isFetching}
        retry={() => void status.refetch()}
      />
    )

  return (
    <div ref={container} className={announcement ? 'portal-announced' : undefined}>
      {announcement && (
        <aside
          className="maintenance-announcement"
          aria-label="Maintenance announcement"
          role="status"
        >
          <Megaphone size={20} aria-hidden="true" />
          <div>
            <strong>{status.data.title}</strong>
            <p>{status.data.message}</p>
            <small>Please save your work before maintenance begins.</small>
          </div>
        </aside>
      )}
      <Suspense fallback={<Spinner />}>
        <Portal />
      </Suspense>
    </div>
  )
}
