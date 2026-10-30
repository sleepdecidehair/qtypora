import type { Text } from '@codemirror/state'
import type { DocumentRecord, LineEnding } from '../../shared/contracts'
import { encodedDocumentByteLength, MAX_DOCUMENT_BYTES } from '../../shared/document-size'

/** A document already above the limit may still be reduced in stages. */
export function fitsPasteBudget(current: Text, next: Text, encoding: DocumentRecord['encoding'], lineEnding: LineEnding): boolean {
  const nextSize = encodedDocumentByteLength(next.toString(), encoding, lineEnding)
  if (nextSize <= MAX_DOCUMENT_BYTES) return true
  const currentSize = encodedDocumentByteLength(current.toString(), encoding, lineEnding)
  return currentSize > MAX_DOCUMENT_BYTES && nextSize < currentSize
}
