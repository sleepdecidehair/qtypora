import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FilePlus2, FolderPlus, Pencil, Trash2, RefreshCw, FolderInput, Undo2 } from 'lucide-react'
import type { DesktopApi, FileEntry, Workspace } from '../../shared/contracts'
import { isDirty, type EditorDocument } from '../hooks/useDocuments'
import { reconcileFileTree, treeKeyboardTarget, visibleFileTree, type FileTreeState } from '../hooks/fileTree'
import { filePathKey, indexWorkspaceFiles } from '../hooks/workspaceFiles'
import { compareWorkspaceEntries, DEFAULT_WORKSPACE_OPTIONS, type WorkspaceOptions } from '../../shared/workspace-options'
import { parentDirectory } from '../hooks/fileContext'
import { useFileContextMenu } from '../hooks/useFileContextMenu'
import type { PendingFileAction } from './FileActionDialog'
import { MoveFileDialog } from './MoveFileDialog'

interface FileTreeProps {
  api: DesktopApi; workspace: Workspace | null; documents: EditorDocument[]; current: EditorDocument | null; refreshVersion: number
  onOpenFolder: (path?: string) => void; onOpen: (path: string) => void; onActivate: (id: string) => void
  onFileAction: (action: PendingFileAction) => void; onError: (message: string) => void; onRefresh: () => void
  workspaceOptions?: WorkspaceOptions
  onWorkspaceOptionsChange?: (options: WorkspaceOptions) => void
  recentFolders?: string[]
}

function emptyTree(): FileTreeState { return { expanded: new Set(), children: {}, selected: null } }

export function FileTree(props: FileTreeProps) {
  const options = props.workspaceOptions ?? DEFAULT_WORKSPACE_OPTIONS
  const [loadedRoot, setLoadedRoot] = useState<{ path: string; options: WorkspaceOptions; entries: FileEntry[] } | null>(null)
  useEffect(() => {
    let current = true
    const path = props.workspace?.path
    if (!path) { setLoadedRoot(null); return }
    void props.api.readDirectory(path, options).then(result => {
      if (!current) return
      if (result.ok) setLoadedRoot({ path, options, entries: result.data })
      else props.onError(result.error.message)
    }).catch((error: unknown) => { if (current) props.onError(error instanceof Error ? error.message : '刷新目录失败') })
    return () => { current = false }
  }, [props.api, props.workspace?.path, props.workspace?.entries, props.refreshVersion, options, props.onError])
  const workspace = props.workspace && loadedRoot?.path === props.workspace.path && loadedRoot.options === options ? { ...props.workspace, entries: loadedRoot.entries } : props.workspace
  return <FileTreeView {...props} workspace={workspace} />
}

function FileTreeView(props: FileTreeProps) {
  const options = props.workspaceOptions ?? DEFAULT_WORKSPACE_OPTIONS
  const updateOptions = (changes: Partial<WorkspaceOptions>) => props.onWorkspaceOptionsChange?.({ ...options, ...changes })
  const [list, setList] = useState<{ files: FileEntry[]; isLoading: boolean; truncated: boolean }>({ files: [], isLoading: false, truncated: false })
  const [moveTarget, setMoveTarget] = useState<FileEntry | null>(null)
  const [moving, setMoving] = useState(false)
  const dragged = useRef<FileEntry | null>(null)
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
  const showFileContextMenu = useFileContextMenu({ ...props, getChildren: () => treeRef.current.children, onMove: setMoveTarget })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    const token = ++generation.current
    const workspace = props.workspace
    const rootKey = workspace ? filePathKey(workspace.path) : null
    if (previousRoot.current !== rootKey || !workspace) {
      previousRoot.current = rootKey
      setMoveTarget(null)
      dragged.current = null
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
          const result = await props.api.readDirectory(path, options)
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
  }, [props.api, props.workspace?.path, props.workspace?.entries, props.refreshVersion, commit, options])

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
      const result = await props.api.readDirectory(entry.path, options)
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

  useEffect(() => {
    const root = props.workspace?.path
    if (options.view !== 'list' || !root) return
    let active = true
    const children: Record<string, FileEntry[]> = {}
    setList({ files: [], isLoading: true, truncated: false })
    void indexWorkspaceFiles(async path => {
      const result = await props.api.readDirectory(path, options)
      if (result.ok) children[path] = result.data
      return result
    }, root, { isCancelled: () => !active }).then(result => {
      if (!active) return
      commit({ ...treeRef.current, children: { ...treeRef.current.children, ...children } })
      setList({ files: result.files, isLoading: false, truncated: result.isTruncated })
      if (result.errors.length) errorRef.current(result.errors[0])
    })
    return () => { active = false }
  }, [props.api, props.workspace?.path, props.workspace?.entries, props.refreshVersion, options, commit])
  const listFiles = useMemo(() => [...list.files].sort((first, second) => {
    if (options.foldersFirst) {
      const group = parentDirectory(first.path).localeCompare(parentDirectory(second.path), 'zh-CN', { numeric: true })
      if (group) return group
    }
    return compareWorkspaceEntries(first, second, options)
  }), [list.files, options])
  const openEntry = (entry: FileEntry) => {
    if (/\.(?:md|markdown|mdown|mkd|txt)$/i.test(entry.name)) props.onOpen(entry.path)
    else void props.api.revealFile(entry.path).then(result => { if (!result.ok) errorRef.current(result.error.message) }).catch((error: unknown) => errorRef.current(error instanceof Error ? error.message : '无法显示文件'))
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
      else openEntry(entry)
      return
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'ArrowRight' && entry.kind === 'directory' && !treeRef.current.expanded.has(entry.path)) { void toggleDirectory(entry); return }
    if (event.key === 'ArrowLeft' && entry.kind === 'directory' && treeRef.current.expanded.has(entry.path)) { void toggleDirectory(entry); return }
    focusEntry(treeKeyboardTarget(visible.rows, entry.path, event.key))
  }
  const moveFile = async (entry: FileEntry, directory: string) => {
    if (moving) return
    const root = props.workspace?.path
    setMoving(true)
    try {
      const result = await props.api.moveFile({ path: entry.path, destinationDirectory: directory })
      if (!mounted.current || workspaceRef.current?.path !== root) return
      if (!result.ok) errorRef.current(result.error.message)
      else { setMoveTarget(null); props.onRefresh() }
    } catch (error) { if (mounted.current) errorRef.current(error instanceof Error ? error.message : '移动文件失败') }
    finally { if (mounted.current) setMoving(false) }
  }
  const undoMove = async () => {
    if (moving) return
    setMoving(true)
    try {
      const result = await props.api.undoFileOperation()
      if (!mounted.current) return
      if (!result.ok) errorRef.current(result.error.message)
      else if (result.data) props.onRefresh()
      else errorRef.current('当前窗口没有可以撤销的文件操作。')
    } catch (error) { if (mounted.current) errorRef.current(error instanceof Error ? error.message : '撤销文件操作失败') }
    finally { if (mounted.current) setMoving(false) }
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
    {props.workspace ? <>
      <div className="workspace-options">
        <div><label>视图<select aria-label="文件视图" value={options.view} onChange={event => updateOptions({ view: event.target.value === 'list' ? 'list' : 'tree' })}><option value="tree">文件树</option><option value="list">文章列表</option></select></label><label>排序<select aria-label="文件排序" value={options.sort} onChange={event => updateOptions({ sort: event.target.value as WorkspaceOptions['sort'] })}><option value="natural">自然顺序</option><option value="name">名称</option><option value="modified">修改时间</option><option value="created">创建时间</option></select></label></div>
        <div><label><input type="checkbox" checked={options.descending} onChange={event => updateOptions({ descending: event.target.checked })} />倒序</label><label><input type="checkbox" checked={options.foldersFirst} onChange={event => updateOptions({ foldersFirst: event.target.checked })} />文件夹分组</label></div>
        <div><label><input type="checkbox" checked={options.showHidden} onChange={event => updateOptions({ showHidden: event.target.checked })} />隐藏文件</label><label><input type="checkbox" checked={options.showAllFiles} onChange={event => updateOptions({ showAllFiles: event.target.checked })} />所有文件</label></div>
        <input aria-label="筛选文件名" placeholder="筛选文件名：*.md,!draft*" value={options.filter} maxLength={256} onChange={event => updateOptions({ filter: event.target.value })} />
        <div><select aria-label="最近与固定目录" value="" onChange={event => { if (event.target.value) props.onOpenFolder(event.target.value) }}><option value="">最近与固定目录…</option>{options.pinnedFolders.length ? <optgroup label="固定目录">{options.pinnedFolders.map(path => <option key={path} value={path}>{path}</option>)}</optgroup> : null}{props.recentFolders?.length ? <optgroup label="最近目录">{props.recentFolders.filter(path => !options.pinnedFolders.includes(path)).map(path => <option key={path} value={path}>{path}</option>)}</optgroup> : null}</select><button type="button" disabled={!options.pinnedFolders.includes(props.workspace.path) && options.pinnedFolders.length >= 20} onClick={() => updateOptions({ pinnedFolders: options.pinnedFolders.includes(props.workspace!.path) ? options.pinnedFolders.filter(path => path !== props.workspace!.path) : [...options.pinnedFolders, props.workspace!.path] })}>{options.pinnedFolders.includes(props.workspace.path) ? '取消固定' : '固定目录'}</button></div>
      </div>
      <div className="file-actions"><button className="icon-button" title="新建文件" aria-label="在文件夹中新建文件" onClick={() => action('create-file')}><FilePlus2 size={15} /></button><button className="icon-button" title="新建文件夹" aria-label="在文件夹中新建文件夹" onClick={() => action('create-folder')}><FolderPlus size={15} /></button><button className="icon-button" title="重命名所选项" aria-label="重命名所选项" disabled={!selected} onClick={() => action('rename')}><Pencil size={14} /></button><button className="icon-button" title="移到回收站" aria-label="所选项移到回收站" disabled={!selected} onClick={() => action('trash')}><Trash2 size={14} /></button><button className="icon-button" title="移动所选文件" aria-label="移动所选文件" disabled={moving || selected?.kind !== 'file'} onClick={() => setMoveTarget(selected)}><FolderInput size={14} /></button><button className="icon-button" title="撤销文件操作" aria-label="撤销文件操作" disabled={moving} onClick={() => void undoMove()}><Undo2 size={14} /></button><button className="icon-button" data-testid="refresh-file-tree" aria-label="刷新文件树" title="刷新文件树" onClick={props.onRefresh}><RefreshCw size={14} /></button></div>
      {options.view === 'tree' ? <div role="tree" aria-label="文件夹目录" data-testid="file-tree">
        {visible.rows.map(({ entry, depth }, index) => <div key={entry.path} role="none"><button ref={element => { if (element) buttons.current.set(entry.path, element); else buttons.current.delete(entry.path) }} draggable={entry.kind === 'file' && !moving} onDragStart={event => { dragged.current = entry; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-qtypora-file', entry.path) }} onDragEnd={() => { dragged.current = null }} onDragOver={event => { if (entry.kind === 'directory' && dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={event => { const source = dragged.current; dragged.current = null; if (entry.kind === 'directory' && source) { event.preventDefault(); void moveFile(source, entry.path) } }} role="treeitem" aria-level={depth + 1} aria-expanded={entry.kind === 'directory' ? tree.expanded.has(entry.path) : undefined} aria-selected={selected?.path === entry.path} tabIndex={selectedIsVisible ? selected?.path === entry.path ? 0 : -1 : index === 0 ? 0 : -1} className={`file-tree-row ${selected?.path === entry.path ? 'is-selected' : ''} ${props.current?.path === entry.path ? 'is-current' : ''}`} style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-4))` }} title={entry.path} onFocus={() => { if (treeRef.current.selected?.path !== entry.path) commit({ ...treeRef.current, selected: entry }) }} onClick={() => { commit({ ...treeRef.current, selected: entry }); if (entry.kind === 'directory') void toggleDirectory(entry); else openEntry(entry) }} onKeyDown={event => handleKey(event, entry)} onPointerDown={event => { if (event.button === 2) event.preventDefault() }} onContextMenu={event => { event.preventDefault(); commit({ ...treeRef.current, selected: entry }); void showFileContextMenu(entry) }}>
          {entry.kind === 'directory' ? <>{tree.expanded.has(entry.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{tree.expanded.has(entry.path) ? <FolderOpen size={15} /> : <Folder size={15} />}</> : <><span className="tree-chevron-space" /><FileText size={15} /></>}<span>{entry.name}</span>{loading.has(entry.path) ? <span>…</span> : null}
        </button>{entry.kind === 'directory' && tree.expanded.has(entry.path) && tree.children[entry.path]?.length === 0 ? <small className="tree-empty" style={{ paddingLeft: `calc(var(--space-8) + ${depth} * var(--space-4))` }}>空文件夹</small> : null}</div>)}
      </div> : <div className="article-list" role="list" aria-label="文章列表">{listFiles.slice(0, 1000).map((entry, index) => <div key={entry.path} role="listitem">{options.foldersFirst && (index === 0 || parentDirectory(listFiles[index - 1].path) !== parentDirectory(entry.path)) ? <h3 className="article-list-folder">{parentDirectory(entry.path).slice(props.workspace!.path.length).replace(/^[\\/]/, '') || props.workspace!.name}</h3> : null}<button type="button" className={`article-list-entry ${props.current?.path === entry.path ? 'is-current' : ''}`} title={entry.path} onClick={() => { commit({ ...treeRef.current, selected: entry }); openEntry(entry) }} onContextMenu={event => { event.preventDefault(); commit({ ...treeRef.current, selected: entry }); void showFileContextMenu(entry) }}><strong>{entry.name}</strong><small>{new Date(entry.modifiedAt).toLocaleDateString()} · {entry.path.slice(props.workspace!.path.length + 1)}</small></button></div>)}{list.isLoading ? <p className="empty-hint">正在检索文章…</p> : !listFiles.length ? <p className="empty-hint">没有匹配的文件。</p> : null}{list.truncated || listFiles.length > 1000 ? <p className="empty-hint">文章列表达到显示或检索上限，请缩小文件夹范围。</p> : null}</div>}
      {options.showAllFiles ? <p className="file-browser-help">非 Markdown 文件点击后在系统文件管理器中显示。</p> : null}
      {!props.workspace.entries.length ? <p className="empty-hint">文件夹为空。</p> : null}
      {visible.isTruncated ? <p className="empty-hint">每层最多显示 500 项，当前视图最多 3000 项。</p> : null}
      {Object.keys(tree.children).length > 256 ? <p className="empty-hint">本次刷新最多校验 256 个已浏览目录。</p> : null}
    </> : <p className="empty-hint">浏览文件夹里的 Markdown，<br />随时继续写作。</p>}
    {moveTarget && props.workspace ? <MoveFileDialog name={moveTarget.name} root={props.workspace.path} busy={moving} onMove={directory => void moveFile(moveTarget, directory)} onClose={() => { if (!moving) setMoveTarget(null) }} /> : null}
  </div>
}
