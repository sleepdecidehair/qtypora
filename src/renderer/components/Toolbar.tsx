import { Bold, Italic, Strikethrough, Code, Link, Image, List, ListOrdered, ListTodo, Quote, Table, Sigma, Minus, Undo2, Redo2, FilePlus2, FolderOpen, Save, PanelLeft, Search, Settings2, Code2, MoreHorizontal, Columns3 } from 'lucide-react'
import type { EditorAction } from '../editor/types'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { openFolderShortcut, primaryShortcut, quickOpenShortcut, redoShortcut } from '../platform-shortcuts'

interface ToolbarProps {
  platform: string
  showFormatting: boolean; sourceMode: boolean; disabled: boolean; isSaving: boolean
  onAction: (action: EditorAction) => void; onNew: () => void; onOpen: () => void; onSave: () => void
  onSaveAll: () => void
  onSidebar: () => void; onSource: () => void; onQuickOpen: () => void; onPreferences: () => void
  onOpenFolder: () => void; onExport: (kind: 'html' | 'pdf') => void; onImage: () => void
  onCloseDocument: () => void; onSaveAs: () => void; onRecovery: () => void; onNewWindow: () => void
  focusMode: boolean; typewriterMode: boolean; onFocus: () => void; onTypewriter: () => void
  isContentConstrained: boolean; onContentWidthToggle: () => void
}

export function Toolbar(props: ToolbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isMenuOpen) return
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsMenuOpen(false) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [isMenuOpen])
  const editingDisabled = props.disabled
  const openFolder = openFolderShortcut(props.platform)
  const actionButton = (action: EditorAction, label: string, icon: ReactNode) => <button key={action} className="icon-button" aria-label={label} title={label} disabled={editingDisabled} onClick={() => props.onAction(action)}>{icon}</button>
  const runMenu = (callback: () => void) => { setIsMenuOpen(false); callback() }
  return <header className="toolbar" aria-label="编辑工具栏">
    <div className="toolbar-group">
      <button className="icon-button" data-testid="sidebar-toggle" aria-label="切换侧栏" title={`侧栏 · ${primaryShortcut(props.platform, 'Shift+L')}`} onClick={props.onSidebar}><PanelLeft size={17} /></button>
      <button className="icon-button" data-testid="new-document" aria-label="新建文档" title={`新建 · ${primaryShortcut(props.platform, 'N')}`} onClick={props.onNew}><FilePlus2 size={17} /></button>
      <button className="icon-button" data-testid="open-document" aria-label="打开文档" title={`打开 · ${primaryShortcut(props.platform, 'O')}`} onClick={props.onOpen}><FolderOpen size={17} /></button>
      <button className="icon-button" data-testid="save-document" aria-label="保存文档" title={`保存 · ${primaryShortcut(props.platform, 'S')}`} disabled={props.disabled || props.isSaving} onClick={props.onSave}><Save size={17} /></button>
    </div>
    {props.showFormatting ? <><div className="toolbar-divider" /><div className="toolbar-group formatting-tools">
      <select aria-label="段落样式" title="段落样式" value="" disabled={editingDisabled} onChange={event => { if (event.target.value) props.onAction(event.target.value as EditorAction) }}>
        <option value="">正文</option><option value="paragraph">正文</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={`heading-${level}`}>标题 {level}</option>)}
      </select>
      {actionButton('bold', `加粗 · ${primaryShortcut(props.platform, 'B')}`, <Bold size={16} />)}
      {actionButton('italic', `斜体 · ${primaryShortcut(props.platform, 'I')}`, <Italic size={16} />)}
      {actionButton('strike', '删除线', <Strikethrough size={16} />)}
      {actionButton('inline-code', '行内代码', <Code size={16} />)}
      <div className="toolbar-divider" />
      {actionButton('quote', '引用', <Quote size={16} />)}
      {actionButton('bullet-list', '无序列表', <List size={17} />)}
      {actionButton('ordered-list', '有序列表', <ListOrdered size={17} />)}
      {actionButton('task-list', '任务列表', <ListTodo size={17} />)}
      {actionButton('link', '插入链接', <Link size={16} />)}
      <button className="icon-button" aria-label="插入图片" title="插入本地图片" disabled={editingDisabled} onClick={props.onImage}><Image size={16} /></button>
      {actionButton('table', '插入表格', <Table size={16} />)}
      {actionButton('math', '插入公式', <Sigma size={16} />)}
      {actionButton('rule', '分隔线', <Minus size={16} />)}
      {actionButton('undo', `撤销 · ${primaryShortcut(props.platform, 'Z')}`, <Undo2 size={16} />)}
      {actionButton('redo', `重做 · ${redoShortcut(props.platform)}`, <Redo2 size={16} />)}
    </div></> : null}
    <div className="toolbar-spacer" />
    <div className="toolbar-group">
      <button className="icon-button" data-testid="quick-open" aria-label="快速打开" title={`快速打开 · ${quickOpenShortcut(props.platform)}`} onClick={props.onQuickOpen}><Search size={17} /></button>
      <button className={`icon-button ${props.isContentConstrained ? 'is-active' : ''}`} data-testid="content-width-toggle" aria-label="正文留白" aria-pressed={props.isContentConstrained} title={props.isContentConstrained ? '两侧留白 · 点击铺满宽度' : '铺满宽度 · 点击两侧留白'} onClick={props.onContentWidthToggle}><Columns3 size={18} /></button>
      <button className={`icon-button ${props.sourceMode ? 'is-active' : ''}`} data-testid="source-toggle" aria-label="源码模式" aria-pressed={props.sourceMode} title={`切换源码模式 · ${primaryShortcut(props.platform, '/')}`} onClick={props.onSource}><Code2 size={18} /></button>
      <button className="icon-button" data-testid="preferences-button" aria-label="偏好设置" title="偏好设置" onClick={props.onPreferences}><Settings2 size={17} /></button>
      <div className="menu-anchor" ref={menuRef}>
        <button className={`icon-button ${isMenuOpen ? 'is-active' : ''}`} data-testid="export-menu" aria-label="更多操作" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen(!isMenuOpen)}><MoreHorizontal size={19} /></button>
        {isMenuOpen ? <div className="dropdown" aria-label="更多操作">
          <button data-testid="open-folder" onClick={() => runMenu(props.onOpenFolder)}>打开文件夹{openFolder ? <span>{openFolder}</span> : null}</button>
          <button onClick={() => runMenu(props.onSaveAs)}>另存为<span>{primaryShortcut(props.platform, 'Shift+S')}</span></button>
          <button data-testid="save-all" onClick={() => runMenu(props.onSaveAll)}>保存全部</button>
          <button onClick={() => runMenu(props.onNewWindow)}>新建窗口<span>{primaryShortcut(props.platform, 'Shift+N')}</span></button>
          <div className="menu-separator" />
          <button data-testid="export-html" onClick={() => runMenu(() => props.onExport('html'))}>导出 HTML</button>
          <button data-testid="export-pdf" onClick={() => runMenu(() => props.onExport('pdf'))}>导出 PDF</button>
          <div className="menu-separator" />
          <button disabled={editingDisabled} onClick={() => runMenu(() => props.onAction('code'))}>插入代码块</button>
          <button disabled={editingDisabled} onClick={() => runMenu(() => props.onAction('table'))}>插入表格</button>
          <button disabled={editingDisabled} onClick={() => runMenu(() => props.onAction('math'))}>插入数学公式</button>
          <button disabled={editingDisabled} onClick={() => runMenu(() => props.onAction('clear-format'))}>清除格式</button>
          <button onClick={() => runMenu(() => props.onAction('find'))}>查找<span>{primaryShortcut(props.platform, 'F')}</span></button>
          <button disabled={props.disabled} onClick={() => runMenu(() => props.onAction('replace'))}>替换<span>{primaryShortcut(props.platform, 'H')}</span></button>
          <div className="menu-separator" />
          <button aria-pressed={props.focusMode} onClick={() => runMenu(props.onFocus)}>专注模式<span>{props.focusMode ? '✓' : ''}</span></button>
          <button aria-pressed={props.typewriterMode} onClick={() => runMenu(props.onTypewriter)}>打字机模式<span>{props.typewriterMode ? '✓' : ''}</span></button>
          <button onClick={() => runMenu(props.onRecovery)}>恢复草稿</button>
          <div className="menu-separator" />
          <button onClick={() => runMenu(props.onCloseDocument)}>关闭当前文档<span>{primaryShortcut(props.platform, 'W')}</span></button>
        </div> : null}
      </div>
    </div>
  </header>
}
