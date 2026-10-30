import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { flushSync as flushReactSync } from 'react-dom'
import type { DesktopApi, DocumentRecord, DocumentSnapshot, LineEnding, Result } from '../../shared/contracts'
import { translate, type AppLocale } from '../../shared/i18n'
import type { CloseCoordinator } from '../editor/close-coordinator'
import type { EditorCloseHandle } from '../editor/close-guard'
import { mergeCloseSavedDocument, type CloseMetadataVersion } from './close-metadata'

export interface EditorDocument extends DocumentRecord {
  revision: number
  savedContent: string | null
  isSaving: boolean
  externalChange: 'changed' | 'removed' | null
}

function editorDocument(record: DocumentRecord): EditorDocument {
  return { ...record, revision: 0, savedContent: record.unsaved ? null : record.content, isSaving: false, externalChange: null }
}

export function snapshot(document: EditorDocument): DocumentSnapshot {
  return { id: document.id, content: document.content, revision: document.revision, pendingLineEnding: document.pendingLineEnding ?? null }
}

export function isDirty(document: EditorDocument): boolean {
  return document.content !== document.savedContent || document.externalChange === 'removed' || Boolean(document.pendingLineEnding)
}

export function useDocuments(api: DesktopApi, reportError: (message: string) => void, localeRef: RefObject<AppLocale>, coordinator: CloseCoordinator, editorGuard: RefObject<EditorCloseHandle | null>) {
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const documentsRef = useRef<EditorDocument[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const navigationGeneration = useRef(0)
  const pendingSync = useRef(new Set<string>())
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveLocks = useRef(new Set<string>())
  const reloadLocks = useRef(new Set<string>())
  const syncTasks = useRef(new Set<Promise<boolean>>())
  const closing = useRef(false)
  const deferredDocuments = useRef<Array<{ record: DocumentRecord; shouldActivate: boolean }>>([])
  const closeMetadata = useRef(new Map<string, CloseMetadataVersion>())

  const update = useCallback((transform: (current: EditorDocument[]) => EditorDocument[]) => {
    const next = transform(documentsRef.current)
    documentsRef.current = next
    setDocuments(next)
  }, [])

  const activate = useCallback((id: string) => {
    navigationGeneration.current++
    activeIdRef.current = id
    setActiveId(id)
  }, [])

  const addDocument = useCallback((record: DocumentRecord, shouldActivate = true) => {
    update(current => current.some(item => item.id === record.id)
      ? current
      : [...current, editorDocument(record)])
    if (shouldActivate) activate(record.id)
  }, [activate, update])

  const acceptResult = useCallback(<T,>(result: Result<T>): T | undefined => {
    if (result.ok) return result.data
    reportError(result.error.message)
    return undefined
  }, [reportError])

  const flushSync = useCallback(async () => {
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = null
    const ids = [...pendingSync.current]
    pendingSync.current.clear()
    for (const id of ids) {
      const task = (async () => {
      const document = documentsRef.current.find(item => item.id === id)
      if (!document) return true
      try {
        const result = await api.syncDocument(snapshot(document))
        if (!result.ok) { pendingSync.current.add(id); reportError(result.error.message); return false }
        return true
      } catch (error) {
        pendingSync.current.add(id)
        reportError(error instanceof Error ? error.message : translate(localeRef.current, '草稿同步失败'))
        return false
      }
      })()
      syncTasks.current.add(task)
      void task.then(() => { syncTasks.current.delete(task) })
    }
    const success = (await Promise.all([...syncTasks.current])).every(Boolean)
    if (!success && !syncTimer.current) syncTimer.current = setTimeout(() => { void flushSync() }, 5_000)
    return success
  }, [api, acceptResult, reportError, localeRef])

  const changeContent = useCallback((id: string, content: string) => {
    update(current => current.map(document => document.id === id && document.content !== content
      ? { ...document, content, revision: document.revision + 1 }
      : document))
    pendingSync.current.add(id)
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => { void flushSync() }, 400)
  }, [flushSync, update])

  const changeLineEnding = useCallback((id: string, lineEnding: LineEnding) => {
    if (coordinator.locked) { reportError(translate(localeRef.current, '正在关闭，请稍后重试。')); return }
    const current = documentsRef.current.find(document => document.id === id)
    if (!current || current.readOnly || current.pendingLineEnding === lineEnding) return
    update(all => all.map(document => document.id === id ? { ...document, pendingLineEnding: lineEnding, revision: document.revision + 1 } : document))
    pendingSync.current.add(id)
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => { void flushSync() }, 400)
  }, [coordinator, flushSync, localeRef, reportError, update])

  const create = useCallback(async () => {
    const generation = ++navigationGeneration.current
    const record = acceptResult(await api.createDocument())
    if (record) addDocument(record, generation === navigationGeneration.current)
  }, [api, acceptResult, addDocument])

  const importFile = useCallback(async () => {
    const generation = ++navigationGeneration.current
    const record = acceptResult(await api.importDocument())
    if (record) addDocument(record, generation === navigationGeneration.current)
  }, [api, acceptResult, addDocument])

  const open = useCallback(async (path?: string) => {
    const existing = path ? documentsRef.current.find(item => item.path?.toLowerCase() === path.toLowerCase()) : null
    if (existing) { activate(existing.id); return existing }
    const generation = ++navigationGeneration.current
    const record = acceptResult(await api.openFile(path))
    const isCurrent = generation === navigationGeneration.current
    if (record) addDocument(record, isCurrent)
    return isCurrent ? record ?? null : null
  }, [api, acceptResult, activate, addDocument])

  const reopenClosed = useCallback(async () => {
    const generation = ++navigationGeneration.current
    const record = acceptResult(await api.reopenClosedFile())
    if (record) addDocument(record, generation === navigationGeneration.current)
  }, [api, acceptResult, addDocument])

  const openLinked = useCallback(async (id: string, target: string) => {
    const generation = ++navigationGeneration.current
    const result = acceptResult(await api.openLinkedFile({ id, target }))
    const isCurrent = generation === navigationGeneration.current
    if (result?.document) addDocument(result.document, isCurrent)
    if (!isCurrent || !result) return null
    // An already-open target can contain edits not yet flushed to the main process.
    const local = result.document && documentsRef.current.find(item => item.id === result.document!.id)
    return local ? { ...result, document: local } : result
  }, [api, acceptResult, addDocument])

  const save = useCallback(async (saveAs = false, documentId = activeIdRef.current): Promise<boolean> => {
    const current = documentsRef.current.find(item => item.id === documentId)
    if (!current || saveLocks.current.has(current.id)) return false
    if (reloadLocks.current.has(current.id)) { reportError(translate(localeRef.current, '正在重新载入，请稍后再保存。')); return false }
    const requestedSnapshot = snapshot(current)
    const metadataBefore = { ...(closeMetadata.current.get(current.id) ?? { renamed: 0, external: 0 }) }
    saveLocks.current.add(current.id)
    update(all => all.map(item => item.id === current.id ? { ...item, isSaving: true } : item))
    try {
      const result = await api.saveDocument({ ...requestedSnapshot, saveAs })
      const record = result.ok ? result.data : result.document
      if (record) update(all => all.map(item => item.id === current.id
        ? mergeCloseSavedDocument(item, record, requestedSnapshot.revision, metadataBefore, closeMetadata.current.get(current.id) ?? { renamed: 0, external: 0 })
        : item))
      if (!result.ok) {
        if (record) { pendingSync.current.add(current.id); await flushSync() }
        reportError(result.error.message)
        return false
      }
      if (!record) return false
      return true
    } finally {
      saveLocks.current.delete(current.id)
      update(all => all.map(item => item.id === current.id ? { ...item, isSaving: false } : item))
    }
  }, [api, flushSync, localeRef, reportError, update])

  const beginClose = useCallback(() => {
    if (!coordinator.begin()) { reportError(translate(localeRef.current, '请等待当前操作完成后再关闭。')); return false }
    const guard = editorGuard.current
    try {
      if (activeIdRef.current && (!guard || guard.begin() !== 'locked')) {
        coordinator.end()
        reportError(translate(localeRef.current, '请先结束输入法输入后再关闭。'))
        return false
      }
      closing.current = true
      return true
    } catch (error) {
      coordinator.end()
      throw error
    }
  }, [coordinator, editorGuard, localeRef, reportError])

  const snapshotCloseMetadata = useCallback(() => new Map(documentsRef.current.map(item => [item.id, { ...(closeMetadata.current.get(item.id) ?? { renamed: 0, external: 0 }) }])), [])
  const savedDuringClose = useCallback((record: DocumentRecord, revision: number, baseline: Map<string, CloseMetadataVersion>) => {
    update(all => all.map(item => item.id === record.id
      ? mergeCloseSavedDocument(item, record, revision, baseline.get(record.id) ?? { renamed: 0, external: 0 }, closeMetadata.current.get(record.id) ?? { renamed: 0, external: 0 })
      : item))
  }, [update])

  const restoredAfterClose = useCallback((record: DocumentRecord) => {
    update(all => all.map(item => item.id === record.id
      ? { ...item, ...record, content: item.content, revision: item.revision, pendingLineEnding: item.pendingLineEnding, savedContent: record.unsaved ? null : item.savedContent }
      : item))
  }, [update])

  const endClose = useCallback((closedId?: string) => {
    editorGuard.current?.end()
    closing.current = false
    coordinator.end()
    for (const { record, shouldActivate } of deferredDocuments.current.splice(0)) {
      if (record.id !== closedId) { addDocument(record, shouldActivate); continue }
      // This event was emitted before the close committed. Its ID no longer
      // exists in the main process, so reopen the authorized path instead.
      if (!record.path) { reportError(translate(localeRef.current, '文档已关闭，无法重新打开。')); continue }
      const finish = coordinator.start()
      if (!finish) { reportError(translate(localeRef.current, '文档已关闭，请重新打开文件。')); continue }
      void open(record.path).catch(error => reportError(error instanceof Error ? error.message : translate(localeRef.current, '重新打开文件失败。'))).finally(finish)
    }
  }, [addDocument, coordinator, editorGuard, localeRef, open, reportError])

  const validateClose = useCallback(async (requestId: string, snapshots: DocumentSnapshot[]) => {
    let valid = closing.current && coordinator.locked && !coordinator.invalidated && coordinator.pending === 0 && !editorGuard.current?.blocked
    if (valid) valid = await flushSync()
    valid = valid && closing.current && !coordinator.invalidated && coordinator.pending === 0 && !editorGuard.current?.blocked && snapshots.every(item => {
      const document = documentsRef.current.find(current => current.id === item.id)
      return Boolean(document && document.revision === item.revision && document.content === item.content && (document.pendingLineEnding ?? null) === (item.pendingLineEnding ?? null))
    })
    const result = await api.resolveCloseValidation(requestId, valid)
    if (!result.ok) reportError(result.error.message)
  }, [api, coordinator, editorGuard, flushSync, reportError])

  const close = useCallback(async () => {
    const current = documentsRef.current.find(item => item.id === activeIdRef.current)
    if (!current) return
    if (saveLocks.current.has(current.id)) { reportError(translate(localeRef.current, '正在保存，请稍后再关闭文档。')); return }
    if (!beginClose()) return
    let closedId: string | undefined
    try {
      if (!await flushSync()) return
      const latest = documentsRef.current.find(item => item.id === current.id)
      if (!latest) return
      const metadata = snapshotCloseMetadata()
      const result = await api.closeDocument(snapshot(latest))
      if (!result.ok) {
        for (const saved of result.saved ?? []) savedDuringClose(saved.document, saved.revision, metadata)
        pendingSync.current.add(current.id)
        await flushSync()
        reportError(result.error.message)
        return
      }
      for (const saved of result.data.saved) savedDuringClose(saved.document, saved.revision, metadata)
      if (!result.data.closed) return
      const afterClose = documentsRef.current.find(item => item.id === current.id)
      if (afterClose && (afterClose.revision !== latest.revision || afterClose.content !== latest.content)) {
        const restored = await api.restoreClosedEdit(snapshot(afterClose))
        if (!restored.ok) {
          if (restored.document) restoredAfterClose(restored.document)
          pendingSync.current.add(current.id)
          await flushSync()
          reportError(restored.error.message)
          return
        }
        restoredAfterClose(restored.data)
        await flushSync()
        reportError(translate(localeRef.current, '关闭期间文档发生变化，请重试。'))
        return
      }
      closedId = current.id
      pendingSync.current.delete(current.id)
      closeMetadata.current.delete(current.id)
      flushReactSync(() => {
        update(all => all.filter(item => item.id !== current.id))
        const remaining = documentsRef.current
        if (remaining.length) activate(remaining[remaining.length - 1].id)
        else { activeIdRef.current = null; setActiveId(null) }
      })
      if (!documentsRef.current.length) await create()
    } finally { endClose(closedId) }
  }, [api, activate, beginClose, create, endClose, flushSync, reportError, restoredAfterClose, savedDuringClose, snapshotCloseMetadata, update, localeRef])

  const requestClose = useCallback(async () => {
    let started = false
    try { started = saveLocks.current.size === 0 && beginClose() }
    catch (error) { await api.cancelWindowCloseRequest(); throw error }
    if (!started) { await api.cancelWindowCloseRequest(); return }
    let accepted = false
    try {
      if (!await flushSync()) { await api.cancelWindowCloseRequest(); return }
      const metadata = snapshotCloseMetadata()
      const result = await api.requestWindowClose(documentsRef.current.map(snapshot))
      if (!result.ok) {
        for (const saved of result.saved ?? []) savedDuringClose(saved.document, saved.revision, metadata)
        for (const document of documentsRef.current) pendingSync.current.add(document.id)
        await flushSync()
        reportError(result.error.message)
        return
      }
      for (const saved of result.data.saved) savedDuringClose(saved.document, saved.revision, metadata)
      accepted = result.data.closed
    } finally { if (!accepted) endClose() }
  }, [api, beginClose, endClose, flushSync, reportError, savedDuringClose, snapshotCloseMetadata])

  const windowClosePrevented = useCallback(async (error?: string) => {
    if (error) for (const document of documentsRef.current) pendingSync.current.add(document.id)
    const synced = await flushSync()
    endClose()
    if (error) reportError(error)
    else if (synced) reportError(translate(localeRef.current, '关闭期间文档发生变化，请重试。'))
  }, [endClose, flushSync, localeRef, reportError])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!closing.current || (!coordinator.invalidated && !editorGuard.current?.blocked && coordinator.pending === 0)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [coordinator, editorGuard])

  const reload = useCallback(async (id: string) => {
    if (saveLocks.current.has(id)) { reportError(translate(localeRef.current, '正在保存，请稍后再重新载入。')); return }
    if (reloadLocks.current.has(id)) { reportError(translate(localeRef.current, '正在重新载入，请稍后重试。')); return }
    const current = documentsRef.current.find(item => item.id === id)
    if (!current) return
    reloadLocks.current.add(id)
    let finalReadOnly = current.readOnly
    update(all => all.map(item => item.id === id ? { ...item, readOnly: true } : item))
    try {
      if (!await flushSync()) return
      const before = documentsRef.current.find(item => item.id === id)
      if (!before) return
      const metadata = { ...(closeMetadata.current.get(id) ?? { renamed: 0, external: 0 }) }
      const record = acceptResult(await api.reloadDocument(id))
      if (!record) return
      finalReadOnly = record.readOnly
      let changedDuringReload = false
      update(all => all.map(item => {
        if (item.id !== id) return item
        const merged = mergeCloseSavedDocument(item, record, before.revision, metadata, closeMetadata.current.get(id) ?? { renamed: 0, external: 0 })
        changedDuringReload = item.revision !== before.revision || item.content !== before.content || item.pendingLineEnding !== before.pendingLineEnding
        return changedDuringReload ? merged : { ...merged, content: record.content, pendingLineEnding: null, revision: item.revision + 1 }
      }))
      if (changedDuringReload) {
        pendingSync.current.add(id)
        if (await flushSync()) reportError(translate(localeRef.current, '重新载入期间文档发生变化，已保留当前编辑。'))
      } else pendingSync.current.delete(id)
    } finally {
      reloadLocks.current.delete(id)
      update(all => all.map(item => item.id === id ? { ...item, readOnly: finalReadOnly } : item))
    }
  }, [api, acceptResult, flushSync, reportError, update, localeRef])

  const externalChange = useCallback((id: string, kind: 'changed' | 'removed') => {
    if (!documentsRef.current.some(item => item.id === id)) return
    const version = closeMetadata.current.get(id) ?? { renamed: 0, external: 0 }
    closeMetadata.current.set(id, { ...version, external: version.external + 1 })
    update(all => all.map(item => {
      if (item.id !== id) return item
      return { ...item, externalChange: kind }
    }))
  }, [update])

  const renamed = useCallback((id: string, path: string, name: string) => {
    if (!documentsRef.current.some(item => item.id === id)) return
    const version = closeMetadata.current.get(id) ?? { renamed: 0, external: 0 }
    closeMetadata.current.set(id, { ...version, renamed: version.renamed + 1 })
    update(all => all.map(item => item.id === id ? { ...item, path, name } : item))
  }, [update])


  const recover = useCallback(async (id: string) => {
    const generation = ++navigationGeneration.current
    const record = acceptResult(await api.recoverDraft(id))
    if (!record) return false
    addDocument(record, generation === navigationGeneration.current)
    update(all => all.map(item => item.id === record.id ? { ...item, savedContent: null } : item))
    return true
  }, [api, acceptResult, addDocument, update])

  const nextDocument = useCallback(() => {
    const all = documentsRef.current
    if (all.length < 2) return
    const index = all.findIndex(item => item.id === activeIdRef.current)
    activate(all[(index + 1) % all.length].id)
  }, [activate])

  const tracked = useMemo(() => {
    const wrap = <Args extends unknown[], T>(operation: (...args: Args) => Promise<T>, fallback: T) => async (...args: Args): Promise<T> => {
      const done = coordinator.start()
      if (!done) { reportError(translate(localeRef.current, '正在关闭，请稍后重试。')); return fallback }
      try { return await operation(...args) } finally { done() }
    }
    return {
      create: wrap(create, undefined), importFile: wrap(importFile, undefined),
      open: wrap(open, null), reopenClosed: wrap(reopenClosed, undefined),
      openLinked: wrap(openLinked, null), save: wrap(save, false), reload: wrap(reload, undefined),
      recover: wrap(recover, false),
    }
  }, [coordinator, create, importFile, open, reopenClosed, openLinked, save, reload, recover, reportError, localeRef])

  const guardedActivate = useCallback((id: string) => {
    if (coordinator.locked) { reportError(translate(localeRef.current, '正在关闭，请稍后重试。')); return }
    activate(id)
  }, [activate, coordinator, localeRef, reportError])

  const guardedAddDocument = useCallback((record: DocumentRecord, shouldActivate = true) => {
    if (coordinator.locked) {
      deferredDocuments.current.push({ record, shouldActivate })
      coordinator.invalidate()
      return
    }
    addDocument(record, shouldActivate)
  }, [addDocument, coordinator])

  const guardedNextDocument = useCallback(() => {
    if (coordinator.locked) { reportError(translate(localeRef.current, '正在关闭，请稍后重试。')); return }
    nextDocument()
  }, [coordinator, localeRef, nextDocument, reportError])

  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current) }, [])

  return {
    documents, documentsRef, activeId, active: documents.find(item => item.id === activeId) ?? null,
    activate: guardedActivate, addDocument: guardedAddDocument, changeContent, changeLineEnding, ...tracked, close, requestClose,
    externalChange, renamed, nextDocument: guardedNextDocument, flushSync, acceptResult, validateClose, windowClosePrevented,
  }
}
