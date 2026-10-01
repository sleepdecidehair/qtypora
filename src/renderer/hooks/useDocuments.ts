import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopApi, DocumentRecord, DocumentSnapshot, Result } from '../../shared/contracts'

export interface EditorDocument extends DocumentRecord {
  revision: number
  savedContent: string | null
  isSaving: boolean
  externalChange: 'changed' | 'removed' | null
}

function editorDocument(record: DocumentRecord): EditorDocument {
  return { ...record, revision: 0, savedContent: record.content, isSaving: false, externalChange: null }
}

export function snapshot(document: EditorDocument): DocumentSnapshot {
  return { id: document.id, content: document.content, revision: document.revision }
}

export function isDirty(document: EditorDocument): boolean {
  return document.content !== document.savedContent || document.externalChange === 'removed'
}

export function useDocuments(api: DesktopApi, reportError: (message: string) => void) {
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const documentsRef = useRef<EditorDocument[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const pendingSync = useRef(new Set<string>())
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveLocks = useRef(new Set<string>())
  const syncTasks = useRef(new Set<Promise<void>>())

  const update = useCallback((transform: (current: EditorDocument[]) => EditorDocument[]) => {
    const next = transform(documentsRef.current)
    documentsRef.current = next
    setDocuments(next)
  }, [])

  const activate = useCallback((id: string) => {
    activeIdRef.current = id
    setActiveId(id)
  }, [])

  const addDocument = useCallback((record: DocumentRecord) => {
    update(current => current.some(item => item.id === record.id)
      ? current
      : [...current, editorDocument(record)])
    activate(record.id)
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
      if (!document) return
      try {
        acceptResult(await api.syncDocument(snapshot(document)))
      } catch (error) {
        reportError(error instanceof Error ? error.message : '草稿同步失败')
      }
      })()
      syncTasks.current.add(task)
      void task.then(() => { syncTasks.current.delete(task) })
    }
    await Promise.all([...syncTasks.current])
  }, [api, acceptResult, reportError])

  const changeContent = useCallback((id: string, content: string) => {
    update(current => current.map(document => document.id === id && document.content !== content
      ? { ...document, content, revision: document.revision + 1 }
      : document))
    pendingSync.current.add(id)
    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => { void flushSync() }, 400)
  }, [flushSync, update])

  const create = useCallback(async () => {
    const record = acceptResult(await api.createDocument())
    if (record) addDocument(record)
  }, [api, acceptResult, addDocument])

  const open = useCallback(async (path?: string) => {
    const existing = path ? documentsRef.current.find(item => item.path?.toLowerCase() === path.toLowerCase()) : null
    if (existing) { activate(existing.id); return }
    const record = acceptResult(await api.openFile(path))
    if (record) addDocument(record)
  }, [api, acceptResult, activate, addDocument])

  const save = useCallback(async (saveAs = false, documentId = activeIdRef.current): Promise<boolean> => {
    const current = documentsRef.current.find(item => item.id === documentId)
    if (!current || saveLocks.current.has(current.id)) return false
    const requestedSnapshot = snapshot(current)
    saveLocks.current.add(current.id)
    update(all => all.map(item => item.id === current.id ? { ...item, isSaving: true } : item))
    try {
      const record = acceptResult(await api.saveDocument({ ...requestedSnapshot, saveAs }))
      if (!record) return false
      update(all => all.map(item => {
        if (item.id !== current.id) return item
        // A save response represents the captured revision; later typing remains dirty.
        return {
          ...item, ...record, content: item.revision === requestedSnapshot.revision ? record.content : item.content,
          savedContent: record.content, isSaving: false, externalChange: null,
        }
      }))
      return true
    } finally {
      saveLocks.current.delete(current.id)
      update(all => all.map(item => item.id === current.id ? { ...item, isSaving: false } : item))
    }
  }, [api, acceptResult, update])

  const close = useCallback(async () => {
    const current = documentsRef.current.find(item => item.id === activeIdRef.current)
    if (!current) return
    if (saveLocks.current.has(current.id)) { reportError('正在保存，请稍后再关闭文档。'); return }
    const accepted = acceptResult(await api.closeDocument(snapshot(current)))
    if (!accepted) return
    pendingSync.current.delete(current.id)
    update(all => all.filter(item => item.id !== current.id))
    const remaining = documentsRef.current
    if (remaining.length) activate(remaining[remaining.length - 1].id)
    else { activeIdRef.current = null; setActiveId(null); await create() }
  }, [api, acceptResult, activate, create, reportError, update])

  const requestClose = useCallback(async () => {
    if (saveLocks.current.size > 0) { reportError('正在保存，请稍后再关闭窗口。'); return }
    await flushSync()
    acceptResult(await api.requestWindowClose(documentsRef.current.map(snapshot)))
  }, [api, acceptResult, flushSync, reportError])

  const reload = useCallback(async (id: string) => {
    if (saveLocks.current.has(id)) { reportError('正在保存，请稍后再重新载入。'); return }
    const current = documentsRef.current.find(item => item.id === id)
    if (!current) return
    update(all => all.map(item => item.id === id ? { ...item, readOnly: true } : item))
    try {
      await flushSync()
      const record = acceptResult(await api.reloadDocument(id))
      if (!record) return
      pendingSync.current.delete(id)
      update(all => all.map(item => item.id === id
        ? { ...editorDocument(record), revision: item.revision + 1 }
        : item))
    } finally {
      update(all => all.map(item => item.id === id ? { ...item, readOnly: current.readOnly } : item))
    }
  }, [api, acceptResult, flushSync, reportError, update])

  const externalChange = useCallback((id: string, kind: 'changed' | 'removed') => {
    update(all => all.map(item => {
      if (item.id !== id) return item
      return { ...item, externalChange: kind }
    }))
  }, [update])

  const renamed = useCallback((id: string, path: string, name: string) => {
    update(all => all.map(item => item.id === id ? { ...item, path, name } : item))
  }, [update])

  const recover = useCallback(async (id: string) => {
    const record = acceptResult(await api.recoverDraft(id))
    if (!record) return false
    addDocument(record)
    update(all => all.map(item => item.id === record.id ? { ...item, savedContent: null } : item))
    return true
  }, [api, acceptResult, addDocument, update])

  const nextDocument = useCallback(() => {
    const all = documentsRef.current
    if (all.length < 2) return
    const index = all.findIndex(item => item.id === activeIdRef.current)
    activate(all[(index + 1) % all.length].id)
  }, [activate])

  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current) }, [])

  return {
    documents, documentsRef, activeId, active: documents.find(item => item.id === activeId) ?? null,
    activate, addDocument, changeContent, create, open, save, close, requestClose, reload,
    externalChange, renamed, recover, nextDocument, flushSync, acceptResult,
  }
}
