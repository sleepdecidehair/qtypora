import { describe, expect, it } from 'vitest'
import type { FileEntry, Workspace } from '../../shared/contracts'
import { fileContextActions, isFileContextScopeCurrent, isFileContextTargetCurrent, parentDirectory, type FileContextTarget } from './fileContext'

const folder: FileEntry = { name: 'notes', path: 'C:\\writing\\notes', kind: 'directory', modifiedAt: 0 }
const file: FileEntry = { name: 'draft.md', path: 'C:\\writing\\notes\\draft.md', kind: 'file', modifiedAt: 0 }
const workspace: Workspace = { name: 'writing', path: 'C:\\writing', entries: [folder] }
const target: FileContextTarget = { origin: 'tree', entry: file, workspacePath: workspace.path }
const children = { [folder.path]: [file] }

describe('bound file context menu targets', () => {
  it('keeps the original nested target after selecting another file', () => {
    const another: FileEntry = { ...file, name: 'other.md', path: 'C:\\writing\\notes\\other.md' }
    expect(isFileContextTargetCurrent(target, workspace, { [folder.path]: [file, another] }, [])).toBe(true)
    expect(target.entry.path).toBe(file.path)
  })

  it('rejects a late menu result after switching the workspace', () => {
    expect(isFileContextTargetCurrent(target, { ...workspace, path: 'C:\\another' }, children, [])).toBe(false)
    expect(isFileContextScopeCurrent(target, null, [])).toBe(false)
  })

  it('rejects deleted targets and descendants of a removed folder', () => {
    expect(isFileContextTargetCurrent(target, workspace, { [folder.path]: [] }, [])).toBe(false)
    expect(isFileContextTargetCurrent(target, { ...workspace, entries: [] }, children, [])).toBe(false)
  })

  it('binds an open document to its id and path, not the active document', () => {
    const documentTarget: FileContextTarget = { ...target, origin: 'document', documentId: 'draft' }
    expect(isFileContextTargetCurrent(documentTarget, workspace, {}, [{ id: 'draft', path: file.path }, { id: 'active', path: 'C:\\writing\\active.md' }])).toBe(true)
    expect(isFileContextTargetCurrent(documentTarget, workspace, {}, [{ id: 'draft', path: 'C:\\writing\\renamed.md' }])).toBe(false)
    expect(isFileContextTargetCurrent(documentTarget, workspace, {}, [{ id: 'draft', path: null }])).toBe(false)
    expect(isFileContextTargetCurrent(documentTarget, workspace, {}, [])).toBe(false)
  })

  it('allows a disk-backed document without a workspace and preserves Windows path identity', () => {
    const documentTarget: FileContextTarget = { ...target, origin: 'document', documentId: 'draft', workspacePath: null }
    expect(isFileContextTargetCurrent(documentTarget, null, {}, [{ id: 'draft', path: 'c:/WRITING/notes/DRAFT.md' }])).toBe(true)
    expect(isFileContextTargetCurrent(target, { ...workspace, path: 'c:/WRITING/' }, children, [])).toBe(true)
  })

  it('rejects a tree target outside the captured workspace boundary', () => {
    const outside = { ...file, path: 'C:\\writing-other\\draft.md' }
    expect(isFileContextTargetCurrent({ ...target, entry: outside }, { ...workspace, entries: [outside] }, {}, [])).toBe(false)
  })

  it('does not advertise workspace-only mutations for independently opened files', () => {
    const independent: FileContextTarget = { ...target, origin: 'document', documentId: 'draft', workspacePath: null }
    expect(fileContextActions(independent)).toEqual(['file-open', 'file-new-window', 'file-copy-path', 'file-reveal'])
    expect(fileContextActions({ ...independent, workspacePath: 'D:\\other' })).toEqual(fileContextActions(independent))
  })

  it('offers file duplication while excluding folder duplication and moving the workspace root', () => {
    expect(fileContextActions(target)).toContain('file-duplicate')
    expect(fileContextActions({ ...target, entry: folder })).not.toContain('file-duplicate')
    const root: FileContextTarget = { ...target, entry: { ...folder, path: workspace.path, name: workspace.name } }
    expect(isFileContextTargetCurrent(root, workspace, {}, [])).toBe(true)
    expect(fileContextActions(root)).not.toContain('file-rename')
    expect(fileContextActions(root)).not.toContain('file-trash')
    expect(fileContextActions(root)).toContain('file-new-file')
  })

  it('creates beside a file without turning a drive root into a drive-relative path', () => {
    expect(parentDirectory('C:\\draft.md')).toBe('C:\\')
    expect(parentDirectory('C:/draft.md')).toBe('C:/')
    expect(parentDirectory('C:\\writing\\draft.md')).toBe('C:\\writing')
    expect(parentDirectory('/draft.md')).toBe('/')
    expect(parentDirectory('\\\\server\\share\\draft.md')).toBe('\\\\server\\share')
  })
})
