import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { updateCompletion } from '../lib/updateComplete'

export function UpdateCompleteAnimation({
  releaseId,
  publishedReleaseId,
}: {
  releaseId: string
  publishedReleaseId?: string
}) {
  // Reading is harmless during React's repeated initializer calls. Only the
  // committed component claims the release, immediately before the first paint.
  const [visible, setVisible] = useState(() =>
    updateCompletion.shouldShow(releaseId, 'off', publishedReleaseId),
  )
  const claimed = useRef(false)
  const notice = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!visible || claimed.current) return
    if (updateCompletion.claim(releaseId, 'off', publishedReleaseId)) {
      claimed.current = true
    } else {
      // Persisting the external storage guard can fail between render and paint.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false)
    }
  }, [releaseId, publishedReleaseId, visible])
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => {
      // Keep a focused dismiss control in place; never steal keyboard focus.
      if (!notice.current?.contains(document.activeElement)) setVisible(false)
    }, 10000)
    return () => clearTimeout(timer)
  }, [visible])

  if (!visible) return null
  return (
    <aside ref={notice} className="update-complete" aria-label="Update complete">
      <span className="update-complete-icon" aria-hidden="true">
        <Check size={24} />
      </span>
      <div role="status" aria-live="polite" aria-atomic="true">
        <strong>Update complete</strong>
        <p>DevCare is ready. You can continue working.</p>
      </div>
      <button
        type="button"
        className="btn gray small update-complete-close"
        aria-label="Dismiss update complete message"
        onClick={() => setVisible(false)}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  )
}
