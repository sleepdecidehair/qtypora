import { randomUUID } from 'node:crypto'
import { realpathSync, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { DesktopEvent, DocumentRecord, DocumentSnapshot, SaveRequest } from '../shared/contracts'
import { DesktopError, invalid, object, string } from './errors'
import { canonicalInside, canonicalPath, MAX_DOCUMENT_BYTES, normalizeContent, readMarkdown, saveMarkdown, serialized } from './files'
import { LocalStore } from './preferences'

interface DocumentState {
  record: DocumentRecord
  currentContent: string
  revision: number
  savedContent: string | null
  savedRevision: number
  fileMissing: boolean
  notifiedVersion: string | null
  watcher?: FSWatcher
  timer?: ReturnType<typeof setTimeout>
}

export interface DocumentDialogs {
  chooseSave(record: DocumentRecord): Promise<string | null>
  confirmClose(record: DocumentRecord): Promise<'save' | 'discard' | 'cancel'>
}

export function validateSnapshot(input: unknown): DocumentSnapshot {
  const value = object(input)
  const id = string(value.id, '文档 ID', 100)
  if (typeof value.content !== 'string' || Buffer.byteLength(value.content, 'utf8') > MAX_DOCUMENT_BYTES) invalid('文档内容无效或超过 16 MB。')
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0) invalid('文档版本无效。')
  return { id, content: normalizeContent(value.content), revision: value.revision }
}

export class DocumentSession {
  private readonly documents = new Map<string, DocumentState>()
  readonly allowedRoots = new Set<string>()
  workspace: string | null = null
  private untitledCount = 0
  private closeCheckPending = false
  private readonly closingDocuments = new Set<string>()

  constructor(private readonly store: LocalStore, private readonly dialogs: DocumentDialogs, private readonly send: (event: DesktopEvent) => void) {}

  records(): DocumentRecord[] { return [...this.documents.values()].map((state) => ({ ...state.record, content: state.currentContent })) }

  get(id: string): DocumentState {
    const state = this.documents.get(id)
    if (!state) throw new DesktopError('NOT_FOUND', '此窗口中的文档已关闭。')
    return state
  }

  create(content = ''): DocumentRecord {
    const record: DocumentRecord = {
      id: randomUUID(), path: null, name: `未命名${++this.untitledCount}.md`, content,
      version: null, encoding: 'utf8', lineEnding: this.store.preferences.lineEnding, readOnly: false,
    }
    this.documents.set(record.id, { record, currentContent: content, revision: 0, savedContent: content, savedRevision: 0, fileMissing: false, notifiedVersion: null })
    return record
  }

  async authorize(filePath: string, mayCreate = false): Promise<string> {
    for (const root of this.allowedRoots) {
      try { return await canonicalInside(filePath, root, mayCreate) }
      catch (error) {
        if (!(error instanceof DesktopError && error.code === 'PERMISSION_DENIED')) throw error
      }
    }
    throw new DesktopError('PERMISSION_DENIED', '请先通过原生对话框打开文件或其所在文件夹。')
  }

  async open(filePath: string, chosenByUser = false): Promise<DocumentRecord> {
    const resolved = path.resolve(filePath)
    const recent = this.store.recentFiles.some((item) => item.toLowerCase() === resolved.toLowerCase())
    const canonical = chosenByUser || recent ? await canonicalPath(resolved) : await this.authorize(resolved)
    const existing = [...this.documents.values()].find((state) => state.record.path?.toLowerCase() === canonical.toLowerCase())
    if (existing) return { ...existing.record, content: existing.currentContent }
    const record = await readMarkdown(canonical)
    this.allowedRoots.add(path.dirname(canonical))
    this.documents.set(record.id, { record, currentContent: record.content, savedContent: record.content, savedRevision: 0, revision: 0, fileMissing: false, notifiedVersion: null })
    this.startWatch(record.id)
    await this.store.addRecent(canonical)
    return record
  }

  async sync(snapshot: DocumentSnapshot): Promise<void> {
    await serialized('session:' + snapshot.id, async () => {
      const state = this.get(snapshot.id)
      if (snapshot.revision < state.revision) return
      if (snapshot.revision === state.revision && snapshot.content !== state.currentContent) invalid('相同版本不能包含不同文档内容。')
      state.currentContent = snapshot.content
      state.revision = snapshot.revision
      await this.persistDraft(state)
    })
  }

  private async persistDraft(state: DocumentState): Promise<void> {
    if (!state.fileMissing && state.currentContent === state.savedContent) {
      await this.store.discardDraft(state.record.id)
      return
    }
    await this.store.writeDraft({ id: state.record.id, name: state.record.name, path: state.record.path,
      content: state.currentContent, revision: state.revision, updatedAt: new Date().toISOString() })
  }

  async save(request: SaveRequest): Promise<DocumentRecord | null> {
    // A revision may advance while the native dialog is open. Persist the requested snapshot,
    // and retain the newer draft separately instead of changing its saved state.
    const state = this.get(request.id)
    if (request.revision < state.revision) throw new DesktopError('CONFLICT', '该保存请求已过期，请保存当前内容。')
    if (request.revision === state.revision && request.content !== state.currentContent) invalid('相同版本不能包含不同文档内容。')
    state.currentContent = request.content
    state.revision = request.revision
    await this.persistDraft(state)
    const needsDestination = request.saveAs || !state.record.path || state.record.readOnly
    const destination = needsDestination ? await this.dialogs.chooseSave({ ...state.record, content: request.content }) : state.record.path
    if (!destination) return null
    const canonicalDestination = path.join(await canonicalPath(path.dirname(path.resolve(destination))), path.basename(destination))
    if (needsDestination) this.allowedRoots.add(path.dirname(canonicalDestination))
    return serialized('save-document:' + request.id, async () => {
      const current = this.get(request.id)
      if (request.revision < current.savedRevision) throw new DesktopError('CONFLICT', '较新的内容已经保存，此保存请求已过期。')
      const saved = await saveMarkdown(current.record, canonicalDestination, request.content,
        !needsDestination || (current.record.path?.toLowerCase() === canonicalDestination.toLowerCase()))
      current.record = saved
      current.savedContent = request.content
      current.savedRevision = request.revision
      current.fileMissing = false
      current.notifiedVersion = null
      this.startWatch(saved.id)
      await this.persistDraft(current)
      await this.store.addRecent(canonicalDestination)
      return saved
    })
  }

  async reload(id: string): Promise<DocumentRecord> {
    const state = this.get(id)
    if (!state.record.path) throw new DesktopError('INVALID_INPUT', '新文档还没有磁盘文件。')
    const record = await readMarkdown(state.record.path, id)
    state.record = record
    state.currentContent = record.content
    state.savedContent = record.content
    state.revision = 0
    state.savedRevision = 0
    state.fileMissing = false
    state.notifiedVersion = null
    await this.store.discardDraft(id)
    return record
  }

  async recover(id: string): Promise<DocumentRecord> {
    const draft = this.store.drafts.get(id)
    if (!draft) throw new DesktopError('NOT_FOUND', '该草稿已恢复或删除。')
    if (this.documents.has(id)) return { ...this.get(id).record, content: this.get(id).currentContent }
    let record: DocumentRecord
    if (draft.path) {
      try {
        record = await readMarkdown(draft.path, id)
        this.allowedRoots.add(path.dirname(draft.path))
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
        record = { id, path: null, name: draft.name, content: '', version: null, encoding: 'utf8', lineEnding: this.store.preferences.lineEnding, readOnly: false }
      }
    } else record = { id, path: null, name: draft.name, content: '', version: null, encoding: 'utf8', lineEnding: this.store.preferences.lineEnding, readOnly: false }
    record.content = draft.content
    // The renderer starts the recovered editing session at revision zero.
    this.documents.set(id, { record, currentContent: draft.content, savedContent: null, savedRevision: 0, revision: 0, fileMissing: false, notifiedVersion: null })
    this.startWatch(id)
    await this.persistDraft(this.get(id))
    return record
  }

  async close(snapshot: DocumentSnapshot): Promise<boolean> {
    if (this.closeCheckPending || this.closingDocuments.has(snapshot.id)) return false
    this.closingDocuments.add(snapshot.id)
    try { return await this.closeOneDocument(snapshot) }
    finally { this.closingDocuments.delete(snapshot.id) }
  }

  private async closeOneDocument(snapshot: DocumentSnapshot): Promise<boolean> {
    await this.sync(snapshot)
    const state = this.get(snapshot.id)
    if (state.fileMissing || state.currentContent !== state.savedContent) {
      const answer = await this.dialogs.confirmClose({ ...state.record, content: state.currentContent })
      if (answer === 'cancel') return false
      if (answer === 'save') {
        const latest = this.get(snapshot.id)
        const saved = await this.save({ id: snapshot.id, content: latest.currentContent, revision: latest.revision })
        if (!saved || this.get(snapshot.id).fileMissing || this.get(snapshot.id).currentContent !== this.get(snapshot.id).savedContent) return false
      }
    }
    await this.store.discardDraft(snapshot.id)
    this.stopWatch(state)
    this.documents.delete(snapshot.id)
    return true
  }

  async canCloseWindow(snapshots: DocumentSnapshot[]): Promise<boolean> {
    if (this.closeCheckPending || this.closingDocuments.size > 0) return false
    this.closeCheckPending = true
    try { return await this.checkCloseWindow(snapshots) }
    finally { this.closeCheckPending = false }
  }

  private async checkCloseWindow(snapshots: DocumentSnapshot[]): Promise<boolean> {
    const ids = new Set(snapshots.map((snapshot) => snapshot.id))
    if (ids.size !== snapshots.length || ids.size !== this.documents.size || [...this.documents.keys()].some((id) => !ids.has(id))) invalid('关闭窗口时文档快照不完整，请重试。')
    for (const snapshot of snapshots) await this.sync(snapshot)
    // Do not remove documents until all confirmations have succeeded. Cancelling the last
    // prompt must leave the earlier documents available in the same window.
    const discard = new Set<string>()
    for (const snapshot of snapshots) {
      const state = this.get(snapshot.id)
      if (!state.fileMissing && state.currentContent === state.savedContent) continue
      const answer = await this.dialogs.confirmClose({ ...state.record, content: state.currentContent })
      if (answer === 'cancel') return false
      if (answer === 'discard') { discard.add(snapshot.id); continue }
      const saved = await this.save({ id: snapshot.id, content: state.currentContent, revision: state.revision })
      if (!saved || this.get(snapshot.id).fileMissing || this.get(snapshot.id).currentContent !== this.get(snapshot.id).savedContent) return false
    }
    for (const [id, state] of this.documents) {
      if (!discard.has(id) && (state.fileMissing || state.currentContent !== state.savedContent)) return false
    }
    for (const id of this.documents.keys()) await this.store.discardDraft(id)
    return true
  }

  async updatePaths(source: string, destination: string | null): Promise<void> {
    for (const state of this.documents.values()) {
      const currentPath = state.record.path
      if (!currentPath || (currentPath.toLowerCase() !== source.toLowerCase() && !currentPath.toLowerCase().startsWith(source.toLowerCase() + path.sep))) continue
      if (destination) {
        const next = path.join(destination, path.relative(source, currentPath))
        state.record = { ...state.record, path: next, name: path.basename(next) }
        this.send({ type: 'document-renamed', id: state.record.id, path: next, name: path.basename(next) })
        this.startWatch(state.record.id)
        await this.persistDraft(state)
      } else {
        state.fileMissing = true
        await this.persistDraft(state)
        this.send({ type: 'document-changed', id: state.record.id, kind: 'removed', document: null })
      }
    }
  }

  private startWatch(id: string): void {
    const state = this.get(id)
    this.stopWatch(state)
    if (!state.record.path) return
    const documentPath = state.record.path
    try {
      state.watcher = watch(realpathSync.native(path.dirname(documentPath)), { persistent: false }, (_event, filename) => {
        if (filename && filename.toString().toLowerCase() !== path.basename(documentPath).toLowerCase()) return
        if (state.timer) clearTimeout(state.timer)
        state.timer = setTimeout(() => { void this.notifyFileChange(id).catch(() => console.error('[watch] Document change check failed')) }, 120)
      })
      state.watcher.on('error', () => console.error('[watch] File watcher unavailable'))
    } catch { console.error('[watch] File watcher unavailable') }
  }

  private async notifyFileChange(id: string): Promise<void> {
    const state = this.documents.get(id)
    if (!state?.record.path) return
    try {
      const document = await readMarkdown(state.record.path, id)
      if ((!state.fileMissing && document.version === state.record.version) || document.version === state.notifiedVersion) return
      state.notifiedVersion = document.version
      this.send({ type: 'document-changed', id, kind: 'changed', document })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        state.fileMissing = true
        state.notifiedVersion = null
        await this.persistDraft(state)
        this.send({ type: 'document-changed', id, kind: 'removed', document: null })
      }
      else throw error
    }
  }

  private stopWatch(state: DocumentState): void {
    state.watcher?.close()
    if (state.timer) clearTimeout(state.timer)
    state.watcher = undefined
    state.timer = undefined
  }

  dispose(): void { for (const state of this.documents.values()) this.stopWatch(state) }
}
