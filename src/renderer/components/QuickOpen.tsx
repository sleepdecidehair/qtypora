import { useEffect, useMemo, useState } from 'react'
import { FileText, Search } from 'lucide-react'
import type { EditorDocument } from '../hooks/useDocuments'
import { isDirty } from '../hooks/useDocuments'
import { Dialog } from './Dialog'
import type { DesktopApi, Workspace } from '../../shared/contracts'
import { indexWorkspaceFiles, WORKSPACE_INDEX_LIMITS, type WorkspaceFileIndex } from '../hooks/workspaceFiles'
import { filterQuickOpenItems, quickOpenItems } from '../hooks/quickOpen'

interface QuickOpenProps {
  api: DesktopApi; workspace: Workspace | null; documents: EditorDocument[]; recentFiles: string[]
  onSelectDocument: (id: string) => void; onOpenFile: (path: string) => void; onClose: () => void
}

const EMPTY_INDEX: WorkspaceFileIndex = { files: [], directories: 0, entries: 0, isTruncated: false, errors: [], isCancelled: false }
const DISPLAY_LIMIT = 200

export function QuickOpen({ api, workspace, documents, recentFiles, onSelectDocument, onOpenFile, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [index, setIndex] = useState<WorkspaceFileIndex>(EMPTY_INDEX)
  const [isIndexing, setIsIndexing] = useState(false)
  useEffect(() => {
    let active = true
    setIndex(EMPTY_INDEX)
    const root = workspace?.path
    if (!root) { setIsIndexing(false); return }
    setIsIndexing(true)
    void indexWorkspaceFiles(path => api.readDirectory(path), root, {
      isCancelled: () => !active,
      onProgress: progress => { if (active) setIndex(progress) },
    }).then(result => { if (active) { setIndex(result); setIsIndexing(false) } })
    return () => { active = false }
  }, [api, workspace?.path])
  const items = useMemo(() => {
    const all = quickOpenItems(documents.map(document => ({ id: document.id, name: document.name, path: document.path, isDirty: isDirty(document) })), recentFiles, index.files)
    return filterQuickOpenItems(all, query)
  }, [documents, recentFiles, index.files, query])
  const visibleItems = items.slice(0, DISPLAY_LIMIT)
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(visibleItems.length - 1, 0))
  const select = (index: number) => {
    const item = visibleItems[index]
    if (!item) return
    onClose()
    if (item.id) onSelectDocument(item.id)
    else onOpenFile(item.path)
  }
  return <Dialog title="快速打开" onClose={onClose} className="quick-open-dialog">
    <div className="quick-search"><Search size={18} /><input autoFocus data-testid="quick-open-input" aria-label="搜索文档名称或路径" placeholder="搜索文件名或路径…" value={query} onChange={event => { setQuery(event.target.value); setSelectedIndex(0) }} onKeyDown={event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex(index => Math.min(index + 1, Math.max(visibleItems.length - 1, 0))) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex(index => Math.max(0, index - 1)) }
      if (event.key === 'Enter') { event.preventDefault(); select(safeSelectedIndex) }
    }} /></div>
    <div className="quick-results" role="listbox" aria-label="文档列表">
      {visibleItems.length ? visibleItems.map((item, position) => <button key={item.key} role="option" aria-selected={position === safeSelectedIndex} className={`quick-result ${position === safeSelectedIndex ? 'is-selected' : ''}`} onMouseEnter={() => setSelectedIndex(position)} onClick={() => select(position)}><FileText size={18} /><span><strong>{item.name}{item.isDirty ? ' •' : ''}</strong><small>{item.path}</small></span><em>{item.scope === 'open' ? '已打开' : item.scope === 'recent' ? '最近' : '文件夹'}</em></button>) : <p className="empty-hint">{isIndexing ? '正在检索文件夹…' : '没有匹配的文档。'}</p>}
    </div>
    <div className="quick-index-status" role="status" data-testid="quick-open-status">
      <span>{workspace ? `${workspace.name} · ${isIndexing ? '正在检索' : '已检索'} ${index.directories} 个目录 / ${index.files.length} 个文件` : '已打开的文档与最近文件；打开文件夹可检索其子目录。'}</span>
      <span>{items.length} 个匹配{items.length > DISPLAY_LIMIT ? `，显示前 ${DISPLAY_LIMIT} 个，请缩小查询` : ''}</span>
      {index.isTruncated ? <span>已达到限制：最多 {WORKSPACE_INDEX_LIMITS.directories} 个目录、{WORKSPACE_INDEX_LIMITS.files} 个文件或 {WORKSPACE_INDEX_LIMITS.entries} 项；结果不完整。</span> : null}
      {index.errors.length ? <span className="quick-index-error" title={index.errors.slice(0, 3).join('\n')}>{index.errors.length} 个目录未能读取，结果不完整。{index.errors[0]}</span> : null}
    </div>
    <div className="dialog-footer"><span>↑ ↓ 选择 · Enter 打开 · Esc 关闭</span></div>
  </Dialog>
}
