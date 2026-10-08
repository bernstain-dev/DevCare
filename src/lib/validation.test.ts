import { describe, expect, it } from 'vitest'
import {
  allowedTransitions,
  dateBoundary,
  fileError,
  passwordSchema,
  ticketSchema,
} from './validation'
import { validFile, MAX_BYTES } from '../../supabase/functions/files/validation'
describe('workflow and forms', () => {
  it('allows client confirmation and reopening only from resolved', () => {
    expect(allowedTransitions('Resolved', false)).toEqual(['Closed', 'Open'])
    for (const state of ['Open', 'In Progress', 'Waiting for Client', 'Closed'] as const)
      expect(allowedTransitions(state, false)).toEqual([])
  })
  it('matches the admin workflow', () => {
    expect(allowedTransitions('Open', true)).toEqual([
      'In Progress',
      'Waiting for Client',
      'Resolved',
    ])
    expect(allowedTransitions('In Progress', true)).toEqual(['Waiting for Client', 'Resolved'])
    expect(allowedTransitions('Waiting for Client', true)).toEqual(['In Progress', 'Resolved'])
    expect(allowedTransitions('Closed', true)).toEqual(['Open'])
  })
  it('validates required report content and request types', () => {
    expect(ticketSchema.safeParse({}).success).toBe(false)
    expect(
      ticketSchema.safeParse({
        project_id: crypto.randomUUID(),
        request_type: 'Bug Report',
        title: 'Issue report',
        description: 'Detailed reproduction steps',
        steps_to_reproduce: '',
        expected_behavior: '',
        actual_behavior: '',
        affected_version: '',
        device_browser: '',
        requested_urgency: 'Urgent',
      }).success,
    ).toBe(true)
  })
  it('requires matching strong passwords', () => {
    expect(passwordSchema.safeParse({ password: 'short', confirm: 'short' }).success).toBe(false)
    expect(
      passwordSchema.safeParse({ password: 'a long unique password', confirm: 'different' })
        .success,
    ).toBe(false)
  })
  it('converts Manila calendar filters to UTC', () => {
    expect(dateBoundary('2026-10-08')).toBe('2026-10-07T16:00:00.000Z')
    expect(dateBoundary('2026-10-08', true)).toBe('2026-10-08T15:59:59.999Z')
  })
})
describe('attachment boundaries', () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  it('checks signatures, extensions and empty files', () => {
    expect(validFile('shot.png', 'image/png', png)).toBe(true)
    expect(
      validFile('fake.png', 'image/png', new TextEncoder().encode('<script>bad</script>')),
    ).toBe(false)
    expect(validFile('file.exe', 'image/png', png)).toBe(false)
    expect(validFile('../file.png', 'image/png', png)).toBe(false)
    expect(validFile('empty.pdf', 'application/pdf', new Uint8Array())).toBe(false)
  })
  it('accepts allowed content signatures', () => {
    expect(validFile('file.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.7'))).toBe(
      true,
    )
    expect(validFile('file.jpg', 'image/jpeg', new Uint8Array([255, 216, 255]))).toBe(true)
    expect(validFile('file.webp', 'image/webp', new TextEncoder().encode('RIFFxxxxWEBP'))).toBe(
      true,
    )
  })
  it('enforces the byte limit at the server', () => {
    const huge = new Uint8Array(MAX_BYTES + 1)
    huge.set(png)
    expect(validFile('large.png', 'image/png', huge)).toBe(false)
  })
  it('enforces count, mime, name and size before uploads', () => {
    const file = new File([png], 'shot.png', { type: 'image/png' })
    expect(fileError([file, file, file, file])).toMatch(/three/)
    expect(fileError([file], 3)).toMatch(/three/)
    expect(fileError([new File(['bad'], 'bad.exe', { type: 'application/octet-stream' })])).toMatch(
      /only/,
    )
    expect(fileError([new File([''], 'empty.pdf', { type: 'application/pdf' })])).toMatch(
      /nonempty/,
    )
    expect(fileError([file])).toBeNull()
  })
})
