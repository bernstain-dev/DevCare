import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  X,
} from 'lucide-react'
import { fileError } from '../lib/validation'
export function Spinner() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> Loading…
    </div>
  )
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const message =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  return (
    <div className="alert error" role="alert">
      <AlertCircle size={19} />
      <div>
        {message}
        {retry && (
          <button className="btn gray small" onClick={retry}>
            <RefreshCw size={15} />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="alert">
      <AlertCircle size={18} />
      <div>{children}</div>
    </div>
  )
}
export function Success({ children }: { children: ReactNode }) {
  return (
    <div className="alert success" role="status">
      <Check size={18} />
      <div>{children}</div>
    </div>
  )
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-symbol">
        <Paperclip size={26} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}
export function Badge({ value }: { value: string }) {
  return <span className={`badge ${value.toLowerCase().replaceAll(' ', '-')}`}>{value}</span>
}
export function PageTitle({
  eyebrow = 'YOUR WORKSPACE',
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  )
}
export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string
  error?: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
      {Boolean(error) && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </label>
  )
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog ref={ref} className="modal" aria-label={title} onCancel={onClose}>
      <div className="modal-inner">
        <div className="section-heading">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
export function Pagination({
  page,
  count,
  size = 12,
  onChange,
}: {
  page: number
  count: number
  size?: number
  onChange: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(count / size))
  return (
    <div className="pagination">
      <span>
        {count} result{count !== 1 ? 's' : ''} · Page {page} of {pages}
      </span>
      <div>
        <button className="btn gray small" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={16} />
          Previous
        </button>
        <button
          className="btn gray small"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Next
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
export function FilePicker({
  files,
  onChange,
  existing = 0,
  disabled = false,
}: {
  files: File[]
  onChange: (files: File[]) => void
  existing?: number
  disabled?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="file-picker">
      <label className="file-label">
        <Paperclip size={19} />
        <span>
          Add supporting attachments
          <small>PNG, JPEG, WebP or PDF · 5 MB each · {3 - existing} slots available</small>
        </span>
        <input
          aria-label="Supporting attachments"
          disabled={disabled}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf"
          multiple
          onChange={(e) => {
            const chosen = [...files, ...Array.from(e.target.files ?? [])]
            const problem = fileError(chosen, existing)
            setError(problem)
            if (!problem) onChange(chosen)
            e.target.value = ''
          }}
        />
      </label>
      {files.map((file, i) => (
        <div className="chosen-file" key={`${file.name}-${i}`}>
          <span>
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove ${file.name}`}
            disabled={disabled}
            onClick={() => {
              onChange(files.filter((_, j) => j !== i))
              setError(null)
            }}
          >
            <X size={16} />
          </button>
        </div>
      ))}
      {Boolean(error) && <ErrorBox error={error} />}
    </div>
  )
}
