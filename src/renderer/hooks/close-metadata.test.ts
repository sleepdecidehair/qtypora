import { describe, expect, it } from 'vitest'
import type { EditorDocument } from './useDocuments'
import { mergeCloseSavedDocument } from './close-metadata'

const original: EditorDocument = {
  id: 'a', path: '/old.md', name: 'old.md', content: 'late edit', version: 'old-version', encoding: 'utf8', lineEnding: 'LF', readOnly: false,
  revision: 2, savedContent: 'before', isSaving: false, externalChange: null,
}
const saved = { id: 'a', path: '/saved.md', name: 'saved.md', content: 'saved', version: 'saved-version', encoding: 'utf8' as const, lineEnding: 'LF' as const, readOnly: false }
const initial = { renamed: 0, external: 0 }

describe('close save metadata reconciliation', () => {
  it('retains a later ending choice unless the committed conversion satisfies it', () => {
    const current: EditorDocument = { ...original, pendingLineEnding: 'CRLF' }
    expect(mergeCloseSavedDocument(current, saved, 1, initial, initial).pendingLineEnding).toBe('CRLF')
    expect(mergeCloseSavedDocument(current, { ...saved, savedLineEndingConversion: 'LF' }, 1, initial, initial).pendingLineEnding).toBe('CRLF')
    expect(mergeCloseSavedDocument(current, { ...saved, savedLineEndingConversion: 'CRLF' }, 1, initial, initial).pendingLineEnding).toBeNull()
  })
  it('applies a saved path and baseline while retaining later local edits', () => {
    expect(mergeCloseSavedDocument(original, saved, 1, initial, initial)).toMatchObject({ path: '/saved.md', content: 'late edit', savedContent: 'saved', revision: 2, externalChange: null })
  })

  it('retains a newer rename and external-change notification', () => {
    const current = { ...original, path: '/moved.md', name: 'moved.md', externalChange: 'changed' as const }
    expect(mergeCloseSavedDocument(current, saved, 1, initial, { renamed: 1, external: 1 })).toMatchObject({ path: '/moved.md', name: 'moved.md', content: 'late edit', savedContent: 'saved', externalChange: 'changed' })
  })

  it('does not clear a newer removed-file notification when no rename occurs', () => {
    const current = { ...original, externalChange: 'removed' as const }
    expect(mergeCloseSavedDocument(current, saved, 1, initial, { renamed: 0, external: 1 })).toMatchObject({ path: '/saved.md', externalChange: 'removed' })
  })
})
