import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FilePlus2, FolderPlus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import type { DesktopApi, FileEntry, Workspace } from '../../shared/contracts'
import { isDirty, type EditorDocument } from '../hooks/useDocuments'
import { reconcileFileTree, treeKeyboardTarget, visibleFileTree, type FileTreeState } from '../hooks/fileTree'
import { filePathKey } from '../hooks/workspaceFiles'
import { parentDirectory } from '../hooks/fileContext'
import { useFileContextMenu } from '../hooks/useFileContextMenu'
import type { PendingFileAction } from './FileActionDialog'

interface FileTreeProps {
  api: DesktopApi; workspace: Workspace | null; documents: EditorDocument[]; current: EditorDocument | null; refreshVersion: number
  onOpenFolder: (path?: string) => void; onOpen: (path: string) => void; onActivate: (id: string) => void
  onFileAction: (action: PendingFileAction) => void; onError: (message: string) => void; onRefresh: () => void
}

function emptyTree(): FileTreeState { return { expanded: new Set(), children: {}, selected: null } }

export function FileTree(props: FileTreeProps) {
  const [tree, setTree] = useState<FileTreeState>(emptyTree)
  const treeRef = useRef(tree)
  const [loading, setLoading] = useState(new Set<string>())
  const pendingLoads = useRef(new Set<string>())
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const previousRoot = useRef<string | null>(null)
  const workspaceRef = useRef(props.workspace)
  const errorRef = useRef(props.onError)
  const generation = useRef(0)
  const mounted = useRef(true)
  workspaceRef.current = props.workspace
  errorRef.current = props.onError
  const commit = useCallback((next: FileTreeState) => { treeRef.current = next; setTree(next) }, [])
  const showFileContextMenu = useFileContextMenu({ ...props, getChildren: () => treeRef.current.children })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    const token = ++generation.current
    const workspace = props.workspace
    const rootKey = workspace ? filePathKey(workspace.path) : null
    if (previousRoot.current !== rootKey || !workspace) {
      previousRoot.current = rootKey
      commit(emptyTree()); setLoading(new Set()); pendingLoads.current.clear()
      return
    }
    let active = true
    const valid = reconcileFileTree(workspace.entries, treeRef.current)
    commit(valid)
    const paths = [...new Set([...Object.keys(valid.children), ...valid.expanded])].sort((first, second) => first.length - second.length).slice(0, 256)
    const refreshed: Record<string, FileEntry[]> = {}
    const missing = new Set<string>()
    void (async () => {
      for (const path of paths) {
        if (!active || token !== generation.current) return
        try {
          const result = await props.api.readDirectory(path)
          if (!active || token !== generation.current) return
          if (result.ok) refreshed[path] = result.data
          else if (result.error.code === 'NOT_FOUND') missing.add(filePathKey(path))
          else errorRef.current(result.error.message)
        } catch (error) { if (active) errorRef.current(error instanceof Error ? error.message : '刷新文件树失败') }
      }
      if (!active || token !== generation.current) return
      const latest = treeRef.current
      const next = reconcileFileTree(workspace.entries, { ...latest, children: { ...latest.children, ...refreshed } })
      const isMissing = (path: string) => [...missing].some(prefix => filePathKey(path) === prefix || filePathKey(path).startsWith(prefix + '/'))
      next.expanded = new Set([...next.expanded].filter(path => !isMissing(path)))
      next.children = Object.fromEntries(Object.entries(next.children).filter(([path]) => !isMissing(path)))
      if (next.selected && isMissing(next.selected.path)) next.selected = null
      commit(next)
    })()
    return () => { active = false }
  }, [props.api, props.workspace?.path, props.workspace?.entries, props.refreshVersion, commit])

  const toggleDirectory = async (entry: FileEntry) => {
    const current = treeRef.current
    const expanded = new Set(current.expanded)
    if (expanded.has(entry.path)) { expanded.delete(entry.path); commit({ ...current, expanded }); return }
    expanded.add(entry.path); commit({ ...current, expanded })
    if (current.children[entry.path] || pendingLoads.current.has(entry.path)) return
    pendingLoads.current.add(entry.path)
    setLoading(currentLoading => new Set(currentLoading).add(entry.path))
    const token = generation.current
    const root = workspaceRef.current?.path
    try {
      const result = await props.api.readDirectory(entry.path)
      if (!mounted.current || token !== generation.current || workspaceRef.current?.path !== root) return
      if (!result.ok) { errorRef.current(result.error.message); return }
      const latest = treeRef.current
      commit(reconcileFileTree(workspaceRef.current?.entries ?? [], { ...latest, children: { ...latest.children, [entry.path]: result.data } }))
    } catch (error) { if (mounted.current) errorRef.current(error instanceof Error ? error.message : '读取文件夹失败') }
    finally {
      pendingLoads.current.delete(entry.path)
      if (mounted.current) setLoading(currentLoading => { const next = new Set(currentLoading); next.delete(entry.path); return next })
    }
  }

  const visible = useMemo(() => visibleFileTree(props.workspace?.entries ?? [], tree.children, tree.expanded), [props.workspace?.entries, tree.children, tree.expanded])
  const focusEntry = (path: string | null) => {
    if (!path) return
    const row = visible.rows.find(item => item.entry.path === path)
    if (!row) return
    commit({ ...treeRef.current, selected: row.entry })
    buttons.current.get(path)?.focus()
  }
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, entry: FileEntry) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (entry.kind === 'directory') void toggleDirectory(entry)
      else props.onOpen(entry.path)
      return
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'ArrowRight' && entry.kind === 'directory' && !treeRef.current.expanded.has(entry.path)) { void toggleDirectory(entry); return }
    if (event.key === 'ArrowLeft' && entry.kind === 'directory' && treeRef.current.expanded.has(entry.path)) { void toggleDirectory(entry); return }
    focusEntry(treeKeyboardTarget(visible.rows, entry.path, event.key))
  }
  const selected = tree.selected
  const createParent = selected ? selected.kind === 'directory' ? selected.path : parentDirectory(selected.path) : props.workspace?.path
  const action = (kind: PendingFileAction['action']) => {
    const path = kind === 'create-file' || kind === 'create-folder' ? createParent : selected?.path
    if (path) props.onFileAction({ action: kind, path, name: selected?.name ?? '', isDirectory: selected?.kind === 'directory', contextTarget: props.workspace ? { origin: 'tree', workspacePath: props.workspace.path, entry: selected ?? { path: props.workspace.path, name: props.workspace.name, kind: 'directory', modifiedAt: 0 } } : undefined })
  }
  const selectedIsVisible = visible.rows.some(row => row.entry.path === selected?.path)
  return <div className="sidebar-scroll file-panel">
    <div className="sidebar-section-heading"><h2 className="sidebar-label">已打开</h2><span>{props.documents.length}</span></div>
    {props.documents.map(document => <button key={document.id} className={`open-document-row ${document.id === props.current?.id ? 'is-current' : ''}`} onClick={() => props.onActivate(document.id)} onPointerDown={event => { if (event.button === 2) event.preventDefault() }} onContextMenu={event => { event.preventDefault(); if (document.path) void showFileContextMenu({ name: document.name, path: document.path, kind: 'file', modifiedAt: 0 }, document.id) }} title={document.path ?? '未保存文档'}><FileText size={15} /><span>{document.name}</span>{isDirty(document) ? <span className="dirty-dot" aria-label="未保存">●</span> : null}</button>)}
    <div className="sidebar-section-heading folder-heading"><button className="folder-picker" data-testid="workspace-folder" onClick={() => props.onOpenFolder()} onPointerDown={event => { if (event.button === 2) event.preventDefault() }} onContextMenu={event => { event.preventDefault(); if (props.workspace) void showFileContextMenu({ name: props.workspace.name, path: props.workspace.path, kind: 'directory', modifiedAt: 0 }) }}><FolderOpen size={15} /><span>{props.workspace?.name ?? '打开文件夹'}</span></button></div>
    {props.workspace ? <><div className="file-actions"><button className="icon-button" title="新建文件" aria-label="在文件夹中新建文件" onClick={() => action('create-file')}><FilePlus2 size={15} /></button><button className="icon-button" title="新建文件夹" aria-label="在文件夹中新建文件夹" onClick={() => action('create-folder')}><FolderPlus size={15} /></button><button className="icon-button" title="重命名所选项" aria-label="重命名所选项" disabled={!selected} onClick={() => action('rename')}><Pencil size={14} /></button><button className="icon-button" title="移到回收站" aria-label="所选项移到回收站" disabled={!selected} onClick={() => action('trash')}><Trash2 size={14} /></button><button className="icon-button" data-testid="refresh-file-tree" aria-label="刷新文件树" title="刷新文件树" onClick={props.onRefresh}><RefreshCw size={14} /></button></div>
      <div role="tree" aria-label="文件夹目录" data-testid="file-tree">
        {visible.rows.map(({ entry, depth }, index) => <div key={entry.path} role="none"><button ref={element => { if (element) buttons.current.set(entry.path, element); else buttons.current.delete(entry.path) }} role="treeitem" aria-level={depth + 1} aria-expanded={entry.kind === 'directory' ? tree.expanded.has(entry.path) : undefined} aria-selected={selected?.path === entry.path} tabIndex={selectedIsVisible ? selected?.path === entry.path ? 0 : -1 : index === 0 ? 0 : -1} className={`file-tree-row ${selected?.path === entry.path ? 'is-selected' : ''} ${props.current?.path === entry.path ? 'is-current' : ''}`} style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-4))` }} title={entry.path} onFocus={() => { if (treeRef.current.selected?.path !== entry.path) commit({ ...treeRef.current, selected: entry }) }} onClick={() => { commit({ ...treeRef.current, selected: entry }); if (entry.kind === 'directory') void toggleDirectory(entry); else props.onOpen(entry.path) }} onKeyDown={event => handleKey(event, entry)} onPointerDown={event => { if (event.button === 2) event.preventDefault() }} onContextMenu={event => { event.preventDefault(); commit({ ...treeRef.current, selected: entry }); void showFileContextMenu(entry) }}>
          {entry.kind === 'directory' ? <>{tree.expanded.has(entry.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{tree.expanded.has(entry.path) ? <FolderOpen size={15} /> : <Folder size={15} />}</> : <><span className="tree-chevron-space" /><FileText size={15} /></>}<span>{entry.name}</span>{loading.has(entry.path) ? <span>…</span> : null}
        </button>{entry.kind === 'directory' && tree.expanded.has(entry.path) && tree.children[entry.path]?.length === 0 ? <small className="tree-empty" style={{ paddingLeft: `calc(var(--space-8) + ${depth} * var(--space-4))` }}>空文件夹</small> : null}</div>)}
      </div>
      {!props.workspace.entries.length ? <p className="empty-hint">文件夹为空。</p> : null}
      {visible.isTruncated ? <p className="empty-hint">每层最多显示 500 项，当前视图最多 3000 项。</p> : null}
      {Object.keys(tree.children).length > 256 ? <p className="empty-hint">本次刷新最多校验 256 个已浏览目录。</p> : null}
    </> : <p className="empty-hint">浏览文件夹里的 Markdown，<br />随时继续写作。</p>}
  </div>
}
