import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Files, ListTree, Search, RefreshCw } from 'lucide-react'
import appLogo from '../../../build/icon.svg?no-inline'
import type { DesktopApi, SearchHit, SidebarMode, Workspace } from '../../shared/contracts'
import type { EditorDocument } from '../hooks/useDocuments'
import type { PendingFileAction } from './FileActionDialog'
import { extractHeadings } from '../hooks/outline'
import { FileTree } from './FileTree'
import { SearchHighlight } from './SearchHighlight'
import type { FolderSearchQuery } from '../editor/folder-search-highlight'

interface SidebarProps {
  api: DesktopApi; mode: SidebarMode; workspace: Workspace | null; documents: EditorDocument[]
  current: EditorDocument | null; refreshVersion: number
  onMode: (mode: SidebarMode) => void; onOpenFolder: (path?: string) => void; onOpen: (path: string, line?: number) => void
  onActivate: (id: string) => void; onJump: (line: number) => void
  onFileAction: (action: PendingFileAction) => void; onError: (message: string) => void; onRefresh: () => void
  onSearchChange: (search: FolderSearchQuery | null) => void
}

export function Sidebar(props: SidebarProps) {
  const deferredContent = useDeferredValue(props.current?.content ?? '')
  const outline = useMemo(() => extractHeadings(deferredContent), [deferredContent])
  return <aside className="sidebar" aria-label="文档侧栏">
    <div className="sidebar-tabs" role="tablist" aria-label="侧栏视图">
      <button role="tab" aria-selected={props.mode === 'files'} aria-label="文件" data-testid="files-tab" className={props.mode === 'files' ? 'is-active' : ''} onClick={() => props.onMode('files')}><Files size={16} />文件</button>
      <button role="tab" aria-selected={props.mode === 'outline'} aria-label="大纲" data-testid="outline-tab" className={props.mode === 'outline' ? 'is-active' : ''} onClick={() => props.onMode('outline')}><ListTree size={16} />大纲</button>
      <button role="tab" aria-selected={props.mode === 'search'} aria-label="搜索" data-testid="search-tab" className={props.mode === 'search' ? 'is-active' : ''} onClick={() => props.onMode('search')}><Search size={16} />搜索</button>
    </div>
    {props.mode === 'outline' ? <div className="sidebar-scroll outline-panel"><h2 className="sidebar-label">{props.current?.name ?? '文档大纲'}</h2>{outline.length ? outline.map((heading, index) => <button className="outline-item" data-testid="outline-item" key={`${heading.line}-${index}`} style={{ paddingLeft: `${16 + (heading.level - 1) * 12}px` }} onClick={() => props.onJump(heading.line)} title={heading.text}><span className="outline-marker">{heading.level}</span>{heading.text}</button>) : <p className="empty-hint">用标题组织文章，<br />大纲会出现在这里。</p>}</div> : null}
    {props.mode === 'files' ? <FileTree {...props} /> : null}
    {props.mode === 'search' ? <FolderSearch {...props} /> : null}
    <div className="sidebar-bottom"><span className="product-wordmark"><img data-testid="app-logo" src={appLogo} alt="" aria-hidden="true" />QTypora</span><span>本地 Markdown</span></div>
  </aside>
}


function FolderSearch(props: SidebarProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [resultSet, setResultSet] = useState<{ root: string; query: string; caseSensitive: boolean; hits: SearchHit[] } | null>(null)
  const [selected, setSelected] = useState<{ path: string; line: number } | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchVersion, setSearchVersion] = useState(0)
  const root = props.workspace?.path
  const results = resultSet && resultSet.root === root && resultSet.query === query && resultSet.caseSensitive === caseSensitive ? resultSet.hits : []
  useEffect(() => {
    props.onSearchChange(root && query.trim() ? { query, caseSensitive } : null)
    setSelected(null)
    return () => props.onSearchChange(null)
  }, [props.onSearchChange, root, query, caseSensitive])
  useEffect(() => {
    if (!root || !query.trim()) { setResultSet(null); setIsSearching(false); return }
    let current = true
    setIsSearching(true)
    const timer = setTimeout(() => {
      void props.api.searchFolder({ root, query, caseSensitive }).then(result => {
        if (!current) return
        if (result.ok) setResultSet({ root, query, caseSensitive, hits: result.data })
        else props.onError(result.error.message)
      }).catch((error: unknown) => { if (current) props.onError(error instanceof Error ? error.message : '搜索失败') }).finally(() => { if (current) setIsSearching(false) })
    }, 400)
    return () => { current = false; clearTimeout(timer) }
  }, [props.api, root, props.onError, query, caseSensitive, searchVersion])
  return <div className="sidebar-scroll search-panel">
    <div className="folder-search-input"><Search size={15} /><input data-testid="folder-search-input" aria-label="搜索文件夹内容" placeholder="搜索文件夹内容" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="search-options"><label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />区分大小写</label><button className="icon-button" aria-label="重新搜索" onClick={() => setSearchVersion(value => value + 1)}><RefreshCw size={14} /></button></div>
    {!props.workspace ? <div className="empty-hint"><p>先打开一个文件夹。</p><button className="text-button" onClick={() => props.onOpenFolder()}>打开文件夹</button></div> : <><h2 className="sidebar-label" aria-live="polite">{isSearching ? '正在搜索…' : query ? `${results.length} 个结果` : props.workspace.name}</h2>{results.slice(0, 300).map((hit, index) => <button key={`${hit.path}-${hit.line}-${index}`} className="search-result" aria-current={selected?.path === hit.path && selected.line === hit.line && props.current?.path === hit.path ? 'location' : undefined} onClick={() => { setSelected({ path: hit.path, line: hit.line }); props.onOpen(hit.path, hit.line) }} title={hit.path}><strong>{hit.name}<span>:{hit.line}</span></strong><small><SearchHighlight text={hit.text} query={query} caseSensitive={caseSensitive} excerpt /></small></button>)}{query && !isSearching && !results.length ? <p className="empty-hint">没有匹配的内容。</p> : null}{results.length > 300 ? <p className="empty-hint">当前显示前 300 个结果，请缩小搜索范围。</p> : null}</>}
  </div>
}
