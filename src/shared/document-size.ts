import type { DocumentRecord, LineEnding } from './contracts'

export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024

/** Matches the bytes written after newline normalization and optional UTF-8 BOM. */
export function encodedDocumentByteLength(content: string, encoding: DocumentRecord['encoding'], lineEnding: LineEnding): number {
  const normalized = content.replace(/\r\n?/g, '\n')
  let length = new TextEncoder().encode(normalized).byteLength + (encoding === 'utf8-bom' ? 3 : 0)
  if (lineEnding === 'CRLF') for (const character of normalized) if (character === '\n') length++
  return length
}
