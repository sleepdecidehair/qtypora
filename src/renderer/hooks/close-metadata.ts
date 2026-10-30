import type { DocumentRecord } from '../../shared/contracts'
import type { EditorDocument } from './useDocuments'

export interface CloseMetadataVersion { renamed: number; external: number }

/** A saved snapshot must not roll back newer file notifications. */
export function mergeCloseSavedDocument(item: EditorDocument, record: DocumentRecord, revision: number, before: CloseMetadataVersion, now: CloseMetadataVersion): EditorDocument {
  const renamed = now.renamed !== before.renamed
  const changed = now.external !== before.external
  return {
    ...item, ...record,
    ...(renamed ? { path: item.path, name: item.name } : {}),
    content: item.revision === revision ? record.content : item.content,
    pendingLineEnding: item.pendingLineEnding && item.pendingLineEnding !== record.savedLineEndingConversion ? item.pendingLineEnding : null,
    savedContent: record.content,
    externalChange: changed ? item.externalChange : null,
  }
}
