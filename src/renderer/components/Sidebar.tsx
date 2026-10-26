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
import type { WorkspaceOptions } from '../../shared/workspace-options'
import { DEFAULT_MARKDOWN_OPTIONS, type MarkdownOptions } from '../../shared/markdown-options'
import { createTextSearch } from '../../shared/search'
import { OutlinePanel } from './OutlinePanel'

interface SidebarProps {
  api: DesktopApi; mode: SidebarMode; workspace: Workspace | null; documents: EditorDocument[]
  current: EditorDocument | null; refreshVersion: number
  onMode: (mode: SidebarMode) => void; onOpenFolder: (path?: string) => void; onOpen: (path: string, line?: number) => void
  onActivate: (id: string) => void; onJump: (line: number) => void
  onFileAction: (action: PendingFileAction) => void; onError: (message: string) => void; onRefresh: () => void
  onSearchChange: (search: FolderSearchQuery | null) => void
  workspaceOptions?: WorkspaceOptions
  onWorkspaceOptionsChange?: (options: WorkspaceOptions) => void
  markdownOptions?: MarkdownOptions
  currentLine?: number
  recentFolders?: string[]
}

export function Sidebar(props: SidebarProps) {
  const deferredContent = useDeferredValue(props.current?.content ?? '')
  const outline = useMemo(() => extractHeadings(deferredContent, props.markdownOptions ?? DEFAULT_MARKDOWN_OPTIONS), [deferredContent, props.markdownOptions])
  return <aside className="sidebar" aria-label="文档侧栏">
    <div className="sidebar-tabs" role="tablist" aria-label="侧栏视图">
      <button role="tab" aria-selected={props.mode === 'files'} aria-label="文件" data-testid="files-tab" className={props.mode === 'files' ? 'is-active' : ''} onClick={() => props.onMode('files')}><Files size={16} />文件</button>
      <button role="tab" aria-selected={props.mode === 'outline'} aria-label="大纲" data-testid="outline-tab" className={props.mode === 'outline' ? 'is-active' : ''} onClick={() => props.onMode('outline')}><ListTree size={16} />大纲</button>
      <button role="tab" aria-selected={props.mode === 'search'} aria-label="搜索" data-testid="search-tab" className={props.mode === 'search' ? 'is-active' : ''} onClick={() => props.onMode('search')}><Search size={16} />搜索</button>
    </div>
    {props.mode === 'outline' ? <OutlinePanel headings={outline} name={props.current?.name ?? '文档大纲'} documentId={props.current?.id} currentLine={props.currentLine} onJump={props.onJump} /> : null}
    {props.mode === 'files' ? <FileTree {...props} /> : null}
    {props.mode === 'search' ? <FolderSearch {...props} /> : null}
    <div className="sidebar-bottom"><span className="product-wordmark"><img data-testid="app-logo" src={appLogo} alt="" aria-hidden="true" />QTypora</span><span>本地 Markdown</span></div>
  </aside>
}


function FolderSearch(props: SidebarProps) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(100)
  const [searchError, setSearchError] = useState('')
  const [resultSet, setResultSet] = useState<{ root: string; query: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean; hits: SearchHit[] } | null>(null)
  const [selected, setSelected] = useState<{ path: string; line: number } | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchVersion, setSearchVersion] = useState(0)
  const root = props.workspace?.path
  const results = resultSet && resultSet.root === root && resultSet.query === query && resultSet.caseSensitive === caseSensitive && resultSet.wholeWord === wholeWord && resultSet.regex === regex ? resultSet.hits : []
  useEffect(() => {
    let valid = false
    try { createTextSearch(query, { caseSensitive, wholeWord, regex }); valid = true } catch { /* The request effect reports invalid syntax. */ }
    props.onSearchChange(root && query.trim() && valid ? { query, caseSensitive, wholeWord, regex } : null)
    setSelected(null); setVisibleLimit(100)
    return () => props.onSearchChange(null)
  }, [props.onSearchChange, root, query, caseSensitive, wholeWord, regex])
  useEffect(() => {
    setSearchError('')
    if (!root || !query.trim()) { setResultSet(null); setIsSearching(false); return }
    try { createTextSearch(query, { caseSensitive, wholeWord, regex }) }
    catch (error) { setResultSet(null); setIsSearching(false); setSearchError(error instanceof Error ? error.message : '正则表达式无效。'); return }
    let current = true
    setIsSearching(true)
    const timer = setTimeout(() => {
      void props.api.searchFolder({ root, query, caseSensitive, wholeWord, regex }).then(result => {
        if (!current) return
        if (result.ok) setResultSet({ root, query, caseSensitive, wholeWord, regex, hits: result.data })
        else { setResultSet(null); setSearchError(result.error.message) }
      }).catch((error: unknown) => { if (current) { setResultSet(null); setSearchError(error instanceof Error ? error.message : '搜索失败') } }).finally(() => { if (current) setIsSearching(false) })
    }, 400)
    return () => { current = false; clearTimeout(timer) }
  }, [props.api, root, query, caseSensitive, wholeWord, regex, searchVersion])
  return <div className="sidebar-scroll search-panel">
    <div className="folder-search-input"><Search size={15} /><input data-testid="folder-search-input" aria-label="搜索文件夹内容" placeholder="搜索文件夹内容" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="search-options"><label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />区分大小写</label><label><input type="checkbox" checked={wholeWord} onChange={event => setWholeWord(event.target.checked)} />全词匹配</label><label><input type="checkbox" checked={regex} onChange={event => setRegex(event.target.checked)} />正则表达式</label><button className="icon-button" aria-label="重新搜索" onClick={() => setSearchVersion(value => value + 1)}><RefreshCw size={14} /></button></div>
    {searchError ? <p className="search-error" role="alert">{searchError}</p> : null}
    {regex ? <p className="search-help">使用 RE2 语法，支持分组、字符类和重复；不支持反向引用、前瞻。</p> : null}
    {!props.workspace ? <div className="empty-hint"><p>先打开一个文件夹。</p><button className="text-button" onClick={() => props.onOpenFolder()}>打开文件夹</button></div> : <><h2 className="sidebar-label" aria-live="polite">{isSearching ? '正在搜索…' : query ? `${results.length} 个结果` : props.workspace.name}</h2>{results.slice(0, visibleLimit).map((hit, index) => <button key={`${hit.path}-${hit.line}-${index}`} className="search-result" aria-current={selected?.path === hit.path && selected.line === hit.line && props.current?.path === hit.path ? 'location' : undefined} onClick={() => { setSelected({ path: hit.path, line: hit.line }); props.onOpen(hit.path, hit.line) }} title={hit.path}><strong>{hit.name}<span>:{hit.line}</span></strong><small><SearchHighlight text={hit.text} query={query} caseSensitive={caseSensitive} wholeWord={wholeWord} regex={regex} excerpt /></small></button>)}{query && !isSearching && !searchError && !results.length ? <p className="empty-hint">没有匹配的内容。</p> : null}{results.length > visibleLimit ? <button type="button" className="text-button search-more" onClick={() => setVisibleLimit(value => value + 100)}>显示更多（已显示 {visibleLimit} / {results.length}）</button> : null}{results.length >= 1000 ? <p className="empty-hint">已达到 1000 条结果上限，请缩小搜索范围。</p> : null}</>}
  </div>
}
