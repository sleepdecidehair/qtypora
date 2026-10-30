import { randomUUID } from 'node:crypto'
import { realpathSync, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { DesktopEvent, DocumentRecord, DocumentSnapshot, LineEnding, SaveRequest } from '../shared/contracts'
import { DesktopError, invalid, object, string } from './errors'
import { canonicalInside, canonicalPath, MAX_DOCUMENT_BYTES, normalizeContent, readClosedMarkdown, readMarkdown, saveMarkdown, serialized } from './files'
import { LocalStore } from './preferences'
import { isPathWithin, relocatedPath, withWorkspaceStructure } from './workspace-lock'
import type { FileIdentity } from './file-snapshot'
import { SystemVersionHistory, type NativeVersionProvider, type VersionDocumentContext, type VersionSummary } from './system-version-history'
import { MacOSVersionProvider } from './macos-version-provider'

interface DocumentState {
  record: DocumentRecord
  currentContent: string
  revision: number
  savedContent: string | null
  savedRevision: number
  pendingLineEnding?: LineEnding
  lastSavedLineEndingConversion?: LineEnding
  fileMissing: boolean
  notifiedVersion: string | null
  fileIdentity?: FileIdentity | null
  watcher?: FSWatcher
  timer?: ReturnType<typeof setTimeout>
}

interface CloseToken {
  state: DocumentState
  revision: number
  content: string
  savedContent: string | null
  path: string | null
  version: string | null
  fileMissing: boolean
  pendingLineEnding?: LineEnding
}

function closeToken(state: DocumentState): CloseToken {
  return { state, revision: state.revision, content: state.currentContent, savedContent: state.savedContent, path: state.record.path, version: state.record.version, fileMissing: state.fileMissing, pendingLineEnding: state.pendingLineEnding }
}

function sameCloseToken(state: DocumentState | undefined, token: CloseToken): boolean {
  return state === token.state && state.revision === token.revision && state.currentContent === token.content && state.savedContent === token.savedContent && state.record.path === token.path && state.record.version === token.version && state.fileMissing === token.fileMissing && state.pendingLineEnding === token.pendingLineEnding
}

function pendingForSnapshot(state: DocumentState, snapshot: DocumentSnapshot): LineEnding | undefined {
  const pending = snapshot.pendingLineEnding === undefined ? state.pendingLineEnding : snapshot.pendingLineEnding ?? undefined
  // A renderer sync can already be in flight when its save commits. The same
  // revision's conversion is fulfilled, so do not recreate its dirty draft.
  if (!state.pendingLineEnding && pending && pending === state.lastSavedLineEndingConversion && state.record.lineEnding === pending && snapshot.revision === state.revision && snapshot.revision >= state.savedRevision && snapshot.content === state.currentContent) return undefined
  return pending
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
  if (value.pendingLineEnding !== undefined && value.pendingLineEnding !== null && value.pendingLineEnding !== 'LF' && value.pendingLineEnding !== 'CRLF') invalid('换行格式无效。')
  return { id, content: normalizeContent(value.content), revision: value.revision, ...(value.pendingLineEnding !== undefined ? { pendingLineEnding: value.pendingLineEnding as LineEnding | null } : {}) }
}

export class DocumentSession {
  private readonly documents = new Map<string, DocumentState>()
  private readonly closedFiles: { path: string }[] = []
  private readonly recentlyClosedStates = new Map<string, DocumentState>()
  private disposed = false
  readonly allowedRoots = new Set<string>()
  workspace: string | null = null
  private untitledCount = 0
  private closeCheckPending = false
  private sealedForClose = false
  private readonly closingDocuments = new Set<string>()
  private readonly versionHistory: SystemVersionHistory

  constructor(private readonly store: LocalStore, private readonly dialogs: DocumentDialogs, private readonly send: (event: DesktopEvent) => void, versionProvider: NativeVersionProvider = new MacOSVersionProvider()) {
    this.versionHistory = new SystemVersionHistory(id => this.versionContext(id), versionProvider)
  }

  private versionContext(id: string): VersionDocumentContext {
    this.assertCanLoad(id)
    const state = this.get(id)
    return { id, path: state.record.path, version: state.record.version, revision: state.revision, content: state.currentContent, fileMissing: state.fileMissing, identity: state.fileIdentity ?? null }
  }

  async listSystemVersions(snapshot: DocumentSnapshot): Promise<VersionSummary[]> {
    await this.sync(snapshot)
    const context = this.versionContext(snapshot.id)
    if (context.revision !== snapshot.revision || context.content !== snapshot.content) throw new DesktopError('CONFLICT', '文档已变化，请重新查看版本历史。')
    return this.versionHistory.list(snapshot.id)
  }

  async readSystemVersion(snapshot: DocumentSnapshot, token: string): Promise<Buffer> {
    await this.sync(snapshot)
    const context = this.versionContext(snapshot.id)
    if (context.revision !== snapshot.revision || context.content !== snapshot.content) throw new DesktopError('CONFLICT', '文档已变化，请重新查看版本历史。')
    return this.versionHistory.read(snapshot.id, token)
  }

  records(): DocumentRecord[] { return [...this.documents.values()].map((state) => ({ ...state.record, content: state.currentContent, pendingLineEnding: state.pendingLineEnding ?? null })) }

  /** Stop new session operations between approval and actual window destruction. */
  sealForWindowClose(): void { this.sealedForClose = true }

  async restoreAfterPreventedWindowClose(): Promise<void> {
    this.sealedForClose = false
    const results = await Promise.allSettled([...this.documents.values()].map(state => this.persistDraft(state)))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }

  private assertCanLoad(id?: string): void {
    if (this.disposed || this.sealedForClose || this.closeCheckPending || (id && this.closingDocuments.has(id))) {
      throw new DesktopError('CONFLICT', '窗口或文档正在关闭，请稍后重试。')
    }
  }

  get(id: string): DocumentState {
    const state = this.documents.get(id)
    if (!state) throw new DesktopError('NOT_FOUND', '此窗口中的文档已关闭。')
    return state
  }

  create(content = ''): DocumentRecord {
    this.assertCanLoad()
    const record: DocumentRecord = {
      id: randomUUID(), path: null, name: `${this.store.preferences.locale === 'en-US' ? 'Untitled' : '未命名'}${++this.untitledCount}.md`, content,
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

  async createImported(content: string): Promise<DocumentRecord> {
    const record = this.create(content)
    const state = this.get(record.id)
    state.savedContent = null
    state.record = { ...state.record, unsaved: true }
    try {
      await this.persistDraft(state)
      this.assertCanLoad(record.id)
    } catch (error) {
      if (this.documents.get(record.id) === state) this.documents.delete(record.id)
      throw error
    }
    return { ...state.record }
  }

  async open(filePath: string, chosenByUser = false): Promise<DocumentRecord> {
    return withWorkspaceStructure(() => this.openAlreadyLocked(filePath, chosenByUser))
  }

  /** Caller must hold the workspace structure lock; used for atomic link creation/open. */
  async openAlreadyLocked(filePath: string, chosenByUser = false): Promise<DocumentRecord> {
    this.assertCanLoad()
    const resolved = path.resolve(filePath)
    const recent = this.store.recentFiles.some((item) => item.toLowerCase() === resolved.toLowerCase())
    const canonical = chosenByUser || recent ? await canonicalPath(resolved) : await this.authorize(resolved)
    this.assertCanLoad()
    const existing = [...this.documents.values()].find((state) => state.record.path === canonical)
    if (existing) { this.assertCanLoad(existing.record.id); return { ...existing.record, content: existing.currentContent, pendingLineEnding: existing.pendingLineEnding ?? null } }
    let fileIdentity: FileIdentity | null = null
    const record = await readMarkdown(canonical, undefined, identity => { fileIdentity = identity })
    this.assertCanLoad()
    await this.store.addRecent(canonical)
    this.assertCanLoad()
    this.allowedRoots.add(path.dirname(canonical))
    this.documents.set(record.id, { record, currentContent: record.content, savedContent: record.content, savedRevision: 0, revision: 0, fileMissing: false, notifiedVersion: null, fileIdentity })
    this.startWatch(record.id)
    return record
  }

  async sync(snapshot: DocumentSnapshot): Promise<void> {
    await serialized('session:' + snapshot.id, async () => {
      const state = this.get(snapshot.id)
      if (snapshot.revision < state.revision) return
      const pending = pendingForSnapshot(state, snapshot)
      if (snapshot.revision === state.revision && (snapshot.content !== state.currentContent || pending !== state.pendingLineEnding)) invalid('相同版本不能包含不同文档内容。')
      state.currentContent = snapshot.content
      state.revision = snapshot.revision
      state.pendingLineEnding = pending
      await this.persistDraft(state)
    })
  }

  private async persistDraft(state: DocumentState): Promise<void> {
    if (!state.fileMissing && state.currentContent === state.savedContent && !state.pendingLineEnding) {
      await this.store.discardDraft(state.record.id)
      return
    }
    await this.store.writeDraft({ id: state.record.id, name: state.record.name, path: state.record.path,
      content: state.currentContent, revision: state.revision, updatedAt: new Date().toISOString(),
      ...(state.pendingLineEnding ? { pendingLineEnding: state.pendingLineEnding, baseVersion: state.record.version, encoding: state.record.encoding } : {}) })
  }

  async save(request: SaveRequest, onCommitted: (document: DocumentRecord) => void = () => {}): Promise<DocumentRecord | null> {
    // A revision may advance while the native dialog is open. Persist the requested snapshot,
    // and retain the newer draft separately instead of changing its saved state.
    const pathAtRequest = this.get(request.id).record.path
    const captured = await serialized('session:' + request.id, async () => {
      const state = this.get(request.id)
      if (request.revision < state.revision) throw new DesktopError('CONFLICT', '该保存请求已过期，请保存当前内容。')
      const pending = pendingForSnapshot(state, request)
      if (request.revision === state.revision && (request.content !== state.currentContent || pending !== state.pendingLineEnding)) invalid('相同版本不能包含不同文档内容。')
      state.currentContent = request.content
      state.revision = request.revision
      state.pendingLineEnding = pending
      await this.persistDraft(state)
      if (state.record.path !== pathAtRequest) throw new DesktopError('CONFLICT', '文件路径已经改变，请重新保存当前文档。')
      return { state, pending }
    })
    const { state, pending } = captured
    // Once the original was removed, its pathname can later refer to a different file
    // with identical bytes. Ask for an explicit destination instead of guessing identity.
    const needsDestination = request.saveAs || !state.record.path || state.record.readOnly || state.fileMissing
    const pathBeforeDialog = state.record.path
    const destination = needsDestination ? await this.dialogs.chooseSave({ ...state.record, content: request.content }) : state.record.path
    if (!destination) return null
    return withWorkspaceStructure(async () => {
      if (this.get(request.id).record.path !== pathBeforeDialog) throw new DesktopError('CONFLICT', '文件路径已经改变，请重新保存当前文档。')
      const canonicalDestination = path.join(await canonicalPath(path.dirname(path.resolve(destination))), path.basename(destination))
      if (needsDestination) this.allowedRoots.add(path.dirname(canonicalDestination))
      return serialized('save-document:' + request.id, async () => {
      const current = this.get(request.id)
      if (request.revision < current.savedRevision) throw new DesktopError('CONFLICT', '较新的内容已经保存，此保存请求已过期。')
      if (current.fileMissing && !needsDestination) throw new DesktopError('CONFLICT', '文件已移除，请重新保存并选择位置。')
      if (!needsDestination && current.record.path !== canonicalDestination) throw new DesktopError('CONFLICT', '文件路径已经改变，请重新保存当前文档。')
      let savedIdentity: FileIdentity | null = null
      const unchangedSave = !needsDestination && pending === undefined && normalizeContent(request.content) === current.record.content
      const priorIdentity = current.fileIdentity
      const saved = { ...await saveMarkdown(current.record, canonicalDestination, request.content,
        !needsDestination || (current.record.path?.toLowerCase() === canonicalDestination.toLowerCase()), identity => { savedIdentity = identity }, pending), unsaved: false, pendingLineEnding: null }
      const verifiedIdentity = savedIdentity as FileIdentity | null
      current.fileIdentity = unchangedSave && (!priorIdentity || !verifiedIdentity || priorIdentity.dev !== verifiedIdentity.dev || priorIdentity.ino !== verifiedIdentity.ino) ? null : verifiedIdentity
      current.record = saved
      current.savedContent = request.content
      current.savedRevision = request.revision
      current.lastSavedLineEndingConversion = pending
      if (current.pendingLineEnding === pending) current.pendingLineEnding = undefined
      current.fileMissing = false
      current.notifiedVersion = null
      this.startWatch(saved.id)
      const result = pending ? { ...saved, savedLineEndingConversion: pending } : saved
      onCommitted(result)
      await this.persistDraft(current)
      await this.store.addRecent(canonicalDestination)
      return result
      })
    })
  }

  async reload(id: string): Promise<DocumentRecord> {
    return withWorkspaceStructure(() => this.reloadAlreadyLocked(id))
  }

  private async reloadAlreadyLocked(id: string): Promise<DocumentRecord> {
    this.assertCanLoad(id)
    const state = this.get(id)
    if (!state.record.path) throw new DesktopError('INVALID_INPUT', '新文档还没有磁盘文件。')
    const token = closeToken(state)
    let fileIdentity: FileIdentity | null = null
    const record = await readMarkdown(state.record.path, id, identity => { fileIdentity = identity })
    return serialized('session:' + id, async () => {
      this.assertCanLoad(id)
      if (!sameCloseToken(this.documents.get(id), token)) throw new DesktopError('CONFLICT', '文档已变化，请重新载入。')
      await this.store.discardDraft(id)
      state.record = record
      state.fileIdentity = fileIdentity
      state.currentContent = record.content
      state.savedContent = record.content
      state.revision = 0
      state.savedRevision = 0
      state.lastSavedLineEndingConversion = undefined
      state.pendingLineEnding = undefined
      state.fileMissing = false
      state.notifiedVersion = null
      return record
    })
  }

  async recover(id: string): Promise<DocumentRecord> {
    return withWorkspaceStructure(() => this.recoverAlreadyLocked(id))
  }

  /** Caller must hold the workspace structure lock when checking cross-window ownership. */
  async recoverAlreadyLocked(id: string): Promise<DocumentRecord> {
    this.assertCanLoad(id)
    const draft = this.store.drafts.get(id)
    if (!draft) throw new DesktopError('NOT_FOUND', '该草稿已恢复或删除。')
    if (this.documents.has(id)) {
      const existing = this.get(id)
      return { ...existing.record, content: existing.currentContent, pendingLineEnding: existing.pendingLineEnding ?? null }
    }
    if (draft.path && draft.pendingLineEnding && !draft.baseVersion) throw new DesktopError('CONFLICT', '草稿缺少可验证的文件版本，请先处理文件冲突。')
    let record: DocumentRecord
    if (draft.path) {
      try {
        record = await readMarkdown(draft.path, id)
        if (draft.pendingLineEnding && draft.baseVersion && record.version !== draft.baseVersion) throw new DesktopError('CONFLICT', '草稿的原文件已发生变化，请先处理文件冲突。')
        this.allowedRoots.add(path.dirname(draft.path))
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
        record = { id, path: null, name: draft.name, content: '', version: null, encoding: draft.encoding ?? 'utf8', lineEnding: this.store.preferences.lineEnding, readOnly: false }
      }
    } else record = { id, path: null, name: draft.name, content: '', version: null, encoding: draft.encoding ?? 'utf8', lineEnding: this.store.preferences.lineEnding, readOnly: false }
    this.assertCanLoad(id)
    // The renderer starts the recovered editing session at revision zero.
    const state: DocumentState = { record, currentContent: draft.content, savedContent: null, savedRevision: 0, revision: 0, fileMissing: false, notifiedVersion: null, pendingLineEnding: draft.pendingLineEnding ?? undefined }
    await this.persistDraft(state)
    this.assertCanLoad(id)
    this.documents.set(id, state)
    this.startWatch(id)
    return { ...record, content: draft.content, pendingLineEnding: state.pendingLineEnding ?? null }
  }

  async close(snapshot: DocumentSnapshot, validate: (snapshots: DocumentSnapshot[]) => Promise<boolean> = async () => true, onSaved: (document: DocumentRecord, revision: number) => void = () => {}): Promise<boolean> {
    if (this.closeCheckPending || this.closingDocuments.has(snapshot.id)) return false
    this.closingDocuments.add(snapshot.id)
    try { return await this.closeOneDocument(snapshot, validate, onSaved) }
    finally { this.closingDocuments.delete(snapshot.id) }
  }

  private async closeOneDocument(snapshot: DocumentSnapshot, validate: (snapshots: DocumentSnapshot[]) => Promise<boolean>, onSaved: (document: DocumentRecord, revision: number) => void): Promise<boolean> {
    await this.sync(snapshot)
    const state = this.get(snapshot.id)
    if (state.revision !== snapshot.revision || state.currentContent !== snapshot.content) return false
    let token = closeToken(state)
    if (state.fileMissing || state.currentContent !== state.savedContent || state.pendingLineEnding) {
      const answer = await this.dialogs.confirmClose({ ...state.record, content: token.content })
      if (answer === 'cancel' || !sameCloseToken(this.documents.get(snapshot.id), token)) return false
      if (answer === 'save') {
        const saved = await this.save({ id: snapshot.id, content: token.content, revision: token.revision }, document => onSaved(document, token.revision))
        const current = this.documents.get(snapshot.id)
        if (!saved || !current || current.revision !== token.revision || current.currentContent !== token.content || current.fileMissing || current.savedContent !== token.content || current.pendingLineEnding) return false
        token = closeToken(current)
      }
    }
    if (!await validate([snapshot]) || !sameCloseToken(this.documents.get(snapshot.id), token)) return false
    try { await this.store.discardDraft(snapshot.id) }
    catch (error) { if (this.documents.get(snapshot.id) === state) await this.persistDraft(state); throw error }
    try {
      if (!sameCloseToken(this.documents.get(snapshot.id), token) || !await validate([snapshot]) || !sameCloseToken(this.documents.get(snapshot.id), token)) {
        if (this.documents.get(snapshot.id) === state) await this.persistDraft(state)
        return false
      }
    } catch (error) { if (this.documents.get(snapshot.id) === state) await this.persistDraft(state); throw error }
    this.stopWatch(state)
    this.documents.delete(snapshot.id)
    this.recentlyClosedStates.set(snapshot.id, state)
    if (this.recentlyClosedStates.size > 20) this.recentlyClosedStates.delete(this.recentlyClosedStates.keys().next().value!)
    if (state.record.path && !state.fileMissing) {
      const path = state.record.path
      const duplicate = this.closedFiles.findIndex(item => item.path === path)
      if (duplicate >= 0) this.closedFiles.splice(duplicate, 1)
      this.closedFiles.unshift({ path })
      this.closedFiles.length = Math.min(this.closedFiles.length, 20)
    }
    return true
  }

  /** Restore a close that raced a renderer edit; the ID and draft remain authoritative. */
  async restoreClosedEdit(snapshot: DocumentSnapshot): Promise<DocumentRecord> {
    this.assertCanLoad(snapshot.id)
    const state = this.recentlyClosedStates.get(snapshot.id)
    if (!state || this.documents.has(snapshot.id)) throw new DesktopError('CONFLICT', '关闭的文档已变化，无法恢复编辑。')
    const pending = pendingForSnapshot(state, snapshot)
    if (snapshot.revision < state.revision || (snapshot.revision === state.revision && (snapshot.content !== state.currentContent || pending !== state.pendingLineEnding))) throw new DesktopError('CONFLICT', '恢复的编辑版本无效。')
    // A separate open can win the race. Keep its session untouched and recover
    // the late edits as an independent unsaved document instead of aliasing a path.
    if (state.record.path && [...this.documents.values()].some(item => item.record.path === state.record.path)) {
      state.record = { ...state.record, path: null, version: null, unsaved: true }
      state.savedContent = null
      state.fileMissing = false
    }
    state.currentContent = snapshot.content
    state.revision = snapshot.revision
    state.pendingLineEnding = pending
    this.documents.set(snapshot.id, state)
    this.recentlyClosedStates.delete(snapshot.id)
    if (state.record.path) {
      const index = this.closedFiles.findIndex(entry => entry.path === state.record.path)
      if (index >= 0) this.closedFiles.splice(index, 1)
    }
    this.startWatch(snapshot.id)
    await serialized('session:' + snapshot.id, () => this.persistDraft(state))
    return { ...state.record, content: state.currentContent, pendingLineEnding: state.pendingLineEnding ?? null }
  }

  /** Closed-file history is per window and contains authorized paths only, never draft text. */
  async reopenClosed(): Promise<DocumentRecord | null> {
    return withWorkspaceStructure(async () => {
      this.assertCanLoad()
      if (this.disposed) throw new DesktopError('CONFLICT', '窗口已关闭，无法重新打开文件。')
      const entry = this.closedFiles[0]
      if (!entry) return null
      let fileIdentity: FileIdentity | null = null
      const record = await readClosedMarkdown(entry.path, identity => { fileIdentity = identity })
      this.assertCanLoad()
      const existing = [...this.documents.values()].find(state => state.record.path === entry.path)
      if (existing) {
        if (this.closingDocuments.has(existing.record.id) || this.closeCheckPending) throw new DesktopError('CONFLICT', '文档正在关闭，请稍后重试。')
        const index = this.closedFiles.indexOf(entry)
        if (index >= 0) this.closedFiles.splice(index, 1)
        return { ...existing.record, content: existing.currentContent }
      }
      await this.store.addRecent(entry.path)
      this.assertCanLoad()
      this.documents.set(record.id, { record, currentContent: record.content, savedContent: record.content, savedRevision: 0, revision: 0, fileMissing: false, notifiedVersion: null, fileIdentity })
      this.startWatch(record.id)
      try {
        // Cover the gap between the first read and installing the watcher.
        let verifiedIdentity: FileIdentity | null = null
        const verified = await readClosedMarkdown(entry.path, identity => { verifiedIdentity = identity })
        this.assertCanLoad(record.id)
        if (verified.version !== record.version) throw new DesktopError('CONFLICT', '文件或窗口状态已变化，请重新打开文件。')
        const initial = fileIdentity as FileIdentity | null, confirmed = verifiedIdentity as FileIdentity | null
        if (!initial || !confirmed || initial.dev !== confirmed.dev || initial.ino !== confirmed.ino) this.get(record.id).fileIdentity = null
      } catch (error) {
        const state = this.documents.get(record.id)
        if (state) this.stopWatch(state)
        this.documents.delete(record.id)
        throw error
      }
      const index = this.closedFiles.indexOf(entry)
      if (index >= 0) this.closedFiles.splice(index, 1)
      return record
    })
  }

  async canCloseWindow(snapshots: DocumentSnapshot[], validate: (snapshots: DocumentSnapshot[]) => Promise<boolean> = async () => true, onSaved: (document: DocumentRecord, revision: number) => void = () => {}): Promise<boolean> {
    if (this.closeCheckPending || this.closingDocuments.size > 0) return false
    this.closeCheckPending = true
    try { return await this.checkCloseWindow(snapshots, validate, onSaved) }
    finally { this.closeCheckPending = false }
  }

  private async checkCloseWindow(snapshots: DocumentSnapshot[], validate: (snapshots: DocumentSnapshot[]) => Promise<boolean>, onSaved: (document: DocumentRecord, revision: number) => void): Promise<boolean> {
    const ids = new Set(snapshots.map((snapshot) => snapshot.id))
    if (ids.size !== snapshots.length || ids.size !== this.documents.size || [...this.documents.keys()].some((id) => !ids.has(id))) invalid('关闭窗口时文档快照不完整，请重试。')
    for (const snapshot of snapshots) await this.sync(snapshot)
    const tokens = new Map<string, CloseToken>()
    for (const snapshot of snapshots) {
      const state = this.get(snapshot.id)
      if (state.revision !== snapshot.revision || state.currentContent !== snapshot.content) return false
      tokens.set(snapshot.id, closeToken(state))
    }
    const current = (): boolean => tokens.size === this.documents.size && [...tokens].every(([id, token]) => sameCloseToken(this.documents.get(id), token))
    for (const snapshot of snapshots) {
      const state = this.get(snapshot.id)
      let token = tokens.get(snapshot.id)!
      if (!token.fileMissing && token.content === token.savedContent && !token.pendingLineEnding) continue
      const answer = await this.dialogs.confirmClose({ ...state.record, content: token.content })
      if (answer === 'cancel' || !current()) return false
      if (answer === 'discard') continue
      const saved = await this.save({ id: snapshot.id, content: token.content, revision: token.revision }, document => onSaved(document, token.revision))
      const latest = this.documents.get(snapshot.id)
      if (!saved || !latest || latest.revision !== token.revision || latest.currentContent !== token.content || latest.fileMissing || latest.savedContent !== token.content || latest.pendingLineEnding) return false
      token = closeToken(latest)
      tokens.set(snapshot.id, token)
      if (!current()) return false
    }
    if (!current() || !await validate(snapshots) || !current()) return false
    const restoreDrafts = async (): Promise<void> => {
      const results = await Promise.allSettled([...this.documents.values()].map(state => this.persistDraft(state)))
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    }
    try {
      for (const id of ids) {
        await this.store.discardDraft(id)
        if (!current()) { await restoreDrafts(); return false }
      }
      if (!await validate(snapshots) || !current()) { await restoreDrafts(); return false }
    } catch (error) { await restoreDrafts(); throw error }
    return true
  }

  async withPathLocks<T>(source: string, operation: () => Promise<T>): Promise<T> {
    const ids = [...this.documents.values()].filter(state => {
      const current = state.record.path
      return current && isPathWithin(current, source)
    }).map(state => state.record.id).sort()
    const lock = (index: number): Promise<T> => index === ids.length ? operation() : serialized('save-document:' + ids[index], () => serialized('session:' + ids[index], () => lock(index + 1)))
    return lock(0)
  }

  async updatePaths(source: string, destination: string | null): Promise<void> {
    await this.preparePathUpdates(source, destination)()
  }

  /** Update in-memory paths/watchers synchronously; return draft persistence for the caller. */
  preparePathUpdates(source: string, destination: string | null): () => Promise<void> {
    if (destination) {
      for (const root of [...this.allowedRoots]) {
        if (!isPathWithin(root, source)) continue
        this.allowedRoots.delete(root)
        this.allowedRoots.add(relocatedPath(source, destination, root))
      }
    }
    const changed: DocumentState[] = []
    for (const state of this.documents.values()) {
      const currentPath = state.record.path
      if (!currentPath || !isPathWithin(currentPath, source)) continue
      if (destination) {
        const next = relocatedPath(source, destination, currentPath)
        state.record = { ...state.record, path: next, name: path.basename(next) }
        this.send({ type: 'document-renamed', id: state.record.id, path: next, name: path.basename(next) })
        this.startWatch(state.record.id)
        changed.push(state)
      } else {
        state.fileMissing = true
        this.send({ type: 'document-changed', id: state.record.id, kind: 'removed', document: null })
        changed.push(state)
      }
    }
    return async () => {
      const failures: unknown[] = []
      for (const state of changed) {
        try { await this.persistDraft(state) } catch (error) { failures.push(error) }
      }
      if (failures.length) throw new DesktopError('IO_ERROR', '目录位置已更新，但部分草稿写入失败；请保留窗口并另存文档。')
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
    const observedPath = state.record.path
    try {
      const document = await readMarkdown(observedPath, id)
      if (state.record.path !== observedPath) return
      if ((!state.fileMissing && document.version === state.record.version) || document.version === state.notifiedVersion) return
      state.notifiedVersion = document.version
      this.send({ type: 'document-changed', id, kind: 'changed', document })
    } catch (error) {
      if (state.record.path !== observedPath) return
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

  dispose(): void { this.disposed = true; this.versionHistory.dispose(); for (const state of this.documents.values()) this.stopWatch(state) }
}
