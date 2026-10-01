import type { ClipboardContent } from '../shared/contracts'
import { invalid, object } from './errors'
import { MAX_DOCUMENT_BYTES } from './files'

export function validateClipboard(value: unknown): ClipboardContent {
  const input = object(value)
  if (typeof input.text !== 'string' || input.text.includes('\0') || Buffer.byteLength(input.text, 'utf8') > MAX_DOCUMENT_BYTES) invalid('剪贴板文本无效或超过 16 MB。')
  if (input.html !== undefined && (typeof input.html !== 'string' || input.html.includes('\0') || Buffer.byteLength(input.html, 'utf8') > MAX_DOCUMENT_BYTES)) invalid('剪贴板 HTML 无效或超过 16 MB。')
  return { text: input.text, ...(input.html === undefined ? {} : { html: input.html as string }) }
}
