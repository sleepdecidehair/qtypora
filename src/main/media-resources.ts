export const MEDIA_MIME: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
}
export const MAX_MEDIA_BYTES = 128 * 1024 * 1024

export interface ByteRange { start: number; end: number }
export function parseByteRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (header === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid'
  const first = match[1] ? Number(match[1]) : undefined
  const second = match[2] ? Number(match[2]) : undefined
  if ((first !== undefined && !Number.isSafeInteger(first)) || (second !== undefined && !Number.isSafeInteger(second))) return 'invalid'
  const start = first ?? Math.max(0, size - (second ?? 0))
  const end = first === undefined ? size - 1 : Math.min(second ?? size - 1, size - 1)
  return start >= size || start > end ? 'invalid' : { start, end }
}
