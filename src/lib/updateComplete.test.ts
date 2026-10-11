import { describe, expect, it } from 'vitest'
import { maintenanceSchema } from './maintenance'
import { createUpdateCompletion, UPDATE_PENDING_KEY, updateShownKey } from './updateComplete'

function fixture() {
  const values = new Map<string, string>()
  const local = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  return { values, local, completion: createUpdateCompletion(() => local) }
}

describe('one-time maintenance completion', () => {
  it('claims a new release only after that release was observed in maintenance', () => {
    const { completion, values } = fixture()
    expect(completion.shouldShow('release-1', 'off')).toBe(false)
    completion.rememberMaintenance('release-1')
    expect(completion.shouldShow('release-1', 'off')).toBe(true)
    // Reading during duplicate React initialization never marks an unseen notice.
    expect(completion.shouldShow('release-1', 'off')).toBe(true)
    expect(values.has(updateShownKey('release-1'))).toBe(false)
    expect(completion.claim('release-1', 'off')).toBe(true)
    expect(values.get(updateShownKey('release-1'))).toBe('release-1')
    expect(values.has(UPDATE_PENDING_KEY)).toBe(false)
  })
  it('does not replay the same release after a document reload', () => {
    const { completion, local } = fixture()
    completion.rememberMaintenance('release-1')
    expect(completion.claim('release-1', 'off')).toBe(true)
    const reloaded = createUpdateCompletion(() => local)
    reloaded.rememberMaintenance('release-1')
    expect(reloaded.shouldShow('release-1', 'off')).toBe(false)
    expect(reloaded.claim('release-1', 'off')).toBe(false)
  })
  it('allows a new release once, following its own maintenance window', () => {
    const { completion } = fixture()
    completion.rememberMaintenance('release-1')
    expect(completion.claim('release-1', 'off')).toBe(true)
    expect(completion.claim('release-2', 'off')).toBe(false)
    completion.rememberMaintenance('release-2')
    expect(completion.claim('release-2', 'off')).toBe(true)
    expect(completion.claim('release-2', 'off')).toBe(false)
  })
  it('ignores invalid markers and invalid release identifiers safely', () => {
    const { completion, values } = fixture()
    values.set(UPDATE_PENDING_KEY, '{invalid JSON}')
    expect(completion.claim('release-1', 'off')).toBe(false)
    completion.rememberMaintenance('../invalid')
    expect(completion.claim('../invalid', 'off')).toBe(false)
    completion.rememberMaintenance('release-1')
    values.set(updateShownKey('release-1'), 'invalid old marker')
    expect(completion.claim('release-1', 'off')).toBe(true)
  })
  it('skips safely when storage access, reads, or writes are blocked', () => {
    const { local } = fixture()
    for (const storage of [
      () => {
        throw new Error('Storage unavailable')
      },
      () => ({
        ...local,
        getItem: () => {
          throw new Error('Read blocked')
        },
      }),
      () => ({
        ...local,
        setItem: () => {
          throw new Error('Quota exceeded')
        },
      }),
      () => ({ ...local, setItem: () => {} }),
    ]) {
      const completion = createUpdateCompletion(storage)
      expect(() => completion.rememberMaintenance('release-1')).not.toThrow()
      expect(completion.claim('release-1', 'off')).toBe(false)
    }
  })
  it('does not depend on successful pending-marker cleanup', () => {
    const { local, values } = fixture()
    const storage = () => ({
      ...local,
      removeItem: () => {
        throw new Error('Removal blocked')
      },
    })
    const completion = createUpdateCompletion(storage)
    completion.rememberMaintenance('release-1')
    expect(completion.claim('release-1', 'off')).toBe(true)
    expect(values.get(updateShownKey('release-1'))).toBe('release-1')
    expect(createUpdateCompletion(storage).claim('release-1', 'off')).toBe(false)
  })
  it('never claims during maintenance, announcement, or an unavailable check', () => {
    const { completion, values } = fixture()
    completion.rememberMaintenance('release-1')
    for (const mode of ['maintenance', 'announcement', 'unavailable'])
      expect(completion.claim('release-1', mode)).toBe(false)
    expect(values.has(updateShownKey('release-1'))).toBe(false)
  })
  it('waits for the bundle matching the published release', () => {
    const { completion } = fixture()
    completion.rememberMaintenance('release-2')
    expect(completion.claim('release-1', 'off', 'release-2')).toBe(false)
    expect(completion.claim('release-2', 'off', 'release-1')).toBe(false)
    expect(completion.claim('release-2', 'off', 'release-2')).toBe(true)
  })
  it('prevents duplicate claims even if storage is cleared within the same document', () => {
    const { completion, values } = fixture()
    completion.rememberMaintenance('release-1')
    expect(completion.claim('release-1', 'off')).toBe(true)
    values.delete(updateShownKey('release-1'))
    completion.rememberMaintenance('release-1')
    expect(completion.claim('release-1', 'off')).toBe(false)
  })
  it('keeps availability behavior for existing or invalid optional release metadata', () => {
    const config = { mode: 'off', title: 'Update', message: 'Complete' }
    expect(maintenanceSchema.parse(config).mode).toBe('off')
    expect(maintenanceSchema.parse({ ...config, release_id: [] }).mode).toBe('off')
    expect(maintenanceSchema.parse({ ...config, release_id: 'release-1' }).release_id).toBe(
      'release-1',
    )
  })
})
