import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }))
import { downloadAttachment, uploadFiles } from './api'
import type { Attachment } from './types'

describe('authenticated attachment downloads', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  it('downloads authenticated bytes and revokes the local URL', async () => {
    vi.useFakeTimers()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-download')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchor = { href: '', rel: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } })
    const bytes = new Blob(['private bytes'])
    invoke.mockResolvedValueOnce({ data: bytes, error: null })
    await downloadAttachment({ id: 'attachment', file_name: 'report.pdf' } as Attachment)
    expect(create).toHaveBeenCalledWith(bytes)
    expect(anchor.download).toBe('report.pdf')
    expect(anchor.click).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(revoke).toHaveBeenCalledWith('blob:local-download')
  })
  it('rejects legacy URL responses instead of bypassing current authorization', async () => {
    invoke.mockResolvedValueOnce({
      data: { url: 'https://storage.example.test/old-signed-url' },
      error: null,
    })
    await expect(
      downloadAttachment({ id: 'attachment', file_name: 'report.pdf' } as Attachment),
    ).rejects.toThrow('Download unavailable')
  })
})
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
