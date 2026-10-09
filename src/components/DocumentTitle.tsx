import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const defaultTitle = 'DevCare — Client Support Portal'
const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/login': 'Sign In',
  '/forgot-password': 'Forgot Password',
  '/reset-password': 'Reset Password',
  '/accept-invitation': 'Accept Invitation',
  '/projects': 'Projects',
  '/clients': 'Clients',
  '/tickets': 'Tickets',
  '/tickets/new': 'Submit Ticket',
  '/notifications': 'Notifications',
  '/settings': 'Profile & Settings',
}

export function DocumentTitle() {
  const { pathname } = useLocation()
  const title =
    titles[pathname] ??
    (pathname.startsWith('/projects/')
      ? 'Project Details'
      : pathname.startsWith('/tickets/')
        ? 'Ticket Details'
        : '')
  useEffect(() => {
    document.title = title ? `${title} | ${defaultTitle}` : defaultTitle
  }, [title])
  return null
}
