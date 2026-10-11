export const DEFAULT_UPDATE_RELEASE_ID = '2026-10-11.1'
export const releaseIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const configuredRelease = import.meta.env.VITE_APP_RELEASE_ID?.trim()
export const UPDATE_RELEASE_ID =
  configuredRelease && releaseIdPattern.test(configuredRelease)
    ? configuredRelease
    : DEFAULT_UPDATE_RELEASE_ID

export const UPDATE_PENDING_KEY = 'devcare:update-pending'
export const updateShownKey = (releaseId: string) => `devcare:update-complete:${releaseId}`
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// A separate coordinator represents one document. Storage survives reloads;
// the in-document guard also protects against duplicate component mounts.
export function createUpdateCompletion(storage: () => BrowserStorage) {
  const shownThisDocument = new Set<string>()
  return {
    rememberMaintenance(releaseId: string) {
      if (!releaseIdPattern.test(releaseId)) return
      try {
        storage().setItem(UPDATE_PENDING_KEY, releaseId)
      } catch {
        // Storage is optional. The portal and its maintenance gate still work.
      }
    },
    shouldShow(releaseId: string, mode: string, publishedReleaseId?: string): boolean {
      if (
        mode !== 'off' ||
        !releaseIdPattern.test(releaseId) ||
        (publishedReleaseId !== undefined && publishedReleaseId !== releaseId) ||
        shownThisDocument.has(releaseId)
      )
        return false
      try {
        const local = storage()
        return (
          local.getItem(UPDATE_PENDING_KEY) === releaseId &&
          local.getItem(updateShownKey(releaseId)) !== releaseId
        )
      } catch {
        return false
      }
    },
    claim(releaseId: string, mode: string, publishedReleaseId?: string): boolean {
      if (!this.shouldShow(releaseId, mode, publishedReleaseId)) return false
      try {
        const local = storage()
        local.setItem(updateShownKey(releaseId), releaseId)
        // Never display if storage cannot persist the reload guard.
        if (local.getItem(updateShownKey(releaseId)) !== releaseId) return false
        shownThisDocument.add(releaseId)
        try {
          if (local.getItem(UPDATE_PENDING_KEY) === releaseId) local.removeItem(UPDATE_PENDING_KEY)
        } catch {
          // The per-release shown marker is sufficient even if cleanup fails.
        }
        return true
      } catch {
        return false
      }
    },
  }
}

export const updateCompletion = createUpdateCompletion(() => window.localStorage)
