import { describe, expect, it } from 'vitest'
import { encodedDocument } from '../main/files'
import { encodedDocumentByteLength, MAX_DOCUMENT_BYTES } from './document-size'

describe('encoded document size', () => {
  it.each(['utf8', 'utf8-bom'] as const)('matches saved UTF-8 bytes for %s and each newline mode', encoding => {
    for (const ending of ['LF', 'CRLF'] as const) {
      for (const text of ['', '中文😀\r\nx\ry\n', 'unpaired \ud800']) {
        expect(encodedDocumentByteLength(text, encoding, ending)).toBe(encodedDocument(text, encoding, ending).length)
      }
    }
  })
  it('counts BOM and CRLF at the exact file size limit', () => {
    const text = 'a'.repeat(MAX_DOCUMENT_BYTES - 4) + '\n'
    expect(encodedDocumentByteLength(text, 'utf8', 'LF')).toBe(MAX_DOCUMENT_BYTES - 3)
    expect(encodedDocumentByteLength(text, 'utf8-bom', 'LF')).toBe(MAX_DOCUMENT_BYTES)
    expect(encodedDocumentByteLength(text, 'utf8-bom', 'CRLF')).toBe(MAX_DOCUMENT_BYTES + 1)
  })
})
