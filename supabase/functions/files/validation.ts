export const MAX_BYTES = 5 * 1024 * 1024
export const MIME_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
}
export function validFile(name: string, mime: string, bytes: Uint8Array): boolean {
  if (
    bytes.length < 1 ||
    bytes.length > MAX_BYTES ||
    name.length < 1 ||
    name.length > 200 ||
    /[\x00-\x1f\\/]/.test(name)
  )
    return false
  if (!MIME_EXTENSIONS[mime]?.includes(name.split('.').pop()?.toLowerCase() ?? '')) return false
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (mime === 'image/png')
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  if (mime === 'image/jpeg')
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/webp')
    return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  return mime === 'application/pdf' && ascii(0, 5) === '%PDF-'
}
