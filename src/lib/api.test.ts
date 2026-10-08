import { beforeEach, describe, expect, it, vi } from 'vitest'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }))
import { uploadFiles } from './api'
describe('partial upload failure recovery', () => {
  beforeEach(() => invoke.mockReset())
  it('keeps only failed files for retry and does not resend successful files', async () => {
    const files = ['one.png', 'two.png', 'three.png'].map(
      (name) => new File(['image'], name, { type: 'image/png' }),
    )
    invoke
      .mockResolvedValueOnce({ data: { id: '1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('Network unavailable') })
      .mockResolvedValueOnce({ data: { id: '3' }, error: null })
    const result = await uploadFiles('ticket', null, files)
    expect(result.failed).toEqual([files[1]])
    expect(result.errors).toEqual(['two.png: Network unavailable'])
    expect(invoke).toHaveBeenCalledTimes(3)
    invoke.mockResolvedValueOnce({ data: { id: '2' }, error: null })
    expect((await uploadFiles('ticket', null, result.failed)).failed).toEqual([])
    expect(invoke).toHaveBeenCalledTimes(4)
  })
  it('does not call the server for invalid files', async () => {
    const result = await uploadFiles('ticket', null, [
      new File(['bad'], 'bad.exe', { type: 'application/octet-stream' }),
    ])
    expect(result.failed).toHaveLength(1)
    expect(invoke).not.toHaveBeenCalled()
  })
})
