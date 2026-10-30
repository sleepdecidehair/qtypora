import { describe, expect, it, vi } from 'vitest'
import { DesktopError } from './errors'
import { setNativeDocumentState } from './native-document-state'

function setup() {
  const window = { setRepresentedFilename: vi.fn(), setDocumentEdited: vi.fn() }
  const documents = { get: vi.fn((id: string) => {
    if (id === 'closed') throw new DesktopError('NOT_FOUND', 'closed')
    return { record: { path: id === 'untitled' ? null : '/authorized/document.md' } }
  }) }
  return { window, documents }
}

describe('native document state', () => {
  it('uses the session path and updates the native dirty marker', () => {
    const { window, documents } = setup()
    setNativeDocumentState('darwin', window, documents, 'open', true)
    expect(window.setRepresentedFilename).toHaveBeenCalledWith('/authorized/document.md')
    expect(window.setDocumentEdited).toHaveBeenCalledWith(true)
    setNativeDocumentState('darwin', window, documents, 'untitled', false)
    expect(window.setRepresentedFilename).toHaveBeenLastCalledWith('')
    setNativeDocumentState('darwin', window, documents, null, false)
    expect(window.setRepresentedFilename).toHaveBeenLastCalledWith('')
  })
  it('rejects invalid or closed ids before changing native state', () => {
    const { window, documents } = setup()
    expect(() => setNativeDocumentState('darwin', window, documents, null, true)).toThrow()
    expect(() => setNativeDocumentState('darwin', window, documents, 'open', 'true')).toThrow()
    expect(() => setNativeDocumentState('darwin', window, documents, 'closed', false)).toThrow()
    expect(window.setRepresentedFilename).not.toHaveBeenCalled()
    expect(window.setDocumentEdited).not.toHaveBeenCalled()
  })
  it('validates but does not call macOS APIs on other platforms', () => {
    const { window, documents } = setup()
    setNativeDocumentState('win32', window, documents, 'open', true)
    expect(documents.get).toHaveBeenCalledWith('open')
    expect(window.setRepresentedFilename).not.toHaveBeenCalled()
    expect(window.setDocumentEdited).not.toHaveBeenCalled()
  })
})
