import { Link } from 'react-router-dom'

export function Brand({
  variant = 'full',
  showName = false,
  to = '/',
  label = 'DevCare dashboard',
  className = '',
  onClick,
}: {
  variant?: 'full' | 'icon'
  showName?: boolean
  to?: string
  label?: string
  className?: string
  onClick?: () => void
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className={`brand brand-${variant} ${className}`}
      onClick={onClick}
    >
      <img
        className="brand-image"
        src={`${import.meta.env.BASE_URL}branding/devcare-${variant === 'full' ? 'logo' : 'icon'}.png`}
        width={variant === 'full' ? 2172 : 32}
        height={variant === 'full' ? 724 : 32}
        alt=""
        decoding="async"
      />
      {variant === 'icon' && showName && <span className="brand-name">DevCare</span>}
    </Link>
  )
}
