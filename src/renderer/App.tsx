import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertCircle, Check, X, FileText, FolderOpen } from 'lucide-react'
import type { AppCommand, BootstrapData, DesktopApi, DraftRecord, Result, Workspace } from '../shared/contracts'
import { MarkdownEditor } from './editor/MarkdownEditor'
import type { FolderSearchQuery } from './editor/folder-search-highlight'
import { renderExportDocument } from './editor/markdown'
import type { ExportFormat, SavedExportPreset } from '../shared/export-options'
import type { PresetConflictStrategy } from '../shared/export-preset-file'
import { resolveHeading, resolveMathLabel, resolveFootnote, resolveExplicitAnchor } from './hooks/outline'
import { articleCss, exportAppearance, exportTheme } from './hooks/appearance'
import { WordStatistics } from './components/WordStatistics'
import { ExportDialog } from './components/ExportDialog'
import type { EditorAction, EditorCommand, EditorSelection, JumpRequest } from './editor/types'
import { isDirty, useDocuments } from './hooks/useDocuments'
import { usePreferences } from './hooks/usePreferences'
import { isFileContextScopeCurrent } from './hooks/fileContext'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { shortcutCommandForEvent } from '../shared/shortcuts'
import { FloatingToolbar } from './components/FloatingToolbar'
import { PreferencesDialog } from './components/PreferencesDialog'
import { QuickOpen } from './components/QuickOpen'
import { DraftRecovery } from './components/DraftRecovery'
import { FileActionDialog, type PendingFileAction } from './components/FileActionDialog'
import { Dialog } from './components/Dialog'
import { primaryShortcut } from './platform-shortcuts'
import { LocaleProvider } from './i18n/locale'
import { translate, type AppLocale } from '../shared/i18n'
import './styles/tokens.css'
import './styles/app.css'
import './styles/features.css'
import './editor/markdown-features.css'
import './editor/image-table-features.css'
import './styles/workspace-features.css'

export default function App() {
  if (!window.desktop) return <div className="startup-state"><AlertCircle size={32} /><h1>桌面服务未连接</h1><p>请通过 Electron 开发命令启动 QTypora。</p></div>
  return <DesktopApp api={window.desktop} />
}

function DesktopApp({ api }: { api: DesktopApi }) {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const localeRef = useRef<AppLocale>('zh-CN')
  const reportError = useCallback((message: string) => { setError(message); setNotice(null) }, [])
  const run = useCallback((task: Promise<unknown>) => { void task.catch((failure: unknown) => reportError(failure instanceof Error ? failure.message : translate(localeRef.current, '操作失败，请重试。'))) }, [reportError])
  const documents = useDocuments(api, reportError, localeRef)
  const { preferences, preferencesRef, loadPreferences, updatePreferences, flushPreferences, theme } = usePreferences(api, reportError)
  localeRef.current = preferences.locale
  const t = (source: string): string => translate(preferences.locale, source)
  const currentT = (source: string): string => translate(preferencesRef.current.locale, source)
  const [isLoading, setIsLoading] = useState(true)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const workspaceRef = useRef<Workspace | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [recentFolders, setRecentFolders] = useState<string[]>([])
  const [platform, setPlatform] = useState('win32')
  const [drafts, setDrafts] = useState<DraftRecord[]>([])
  const [modal, setModal] = useState<'preferences' | 'quick-open' | 'recovery' | 'export' | null>(null)
  const [fileAction, setFileAction] = useState<PendingFileAction | null>(null)
  const [isFileActionPending, setIsFileActionPending] = useState(false)
  const fileActionInProgress = useRef(false)
  const [reloadId, setReloadId] = useState<string | null>(null)
  const [selection, setSelection] = useState<EditorSelection>({ text: '', from: 0, to: 0 })
  const [editorCommand, setEditorCommand] = useState<EditorCommand | null>(null)
  const [jumpRequest, setJumpRequest] = useState<JumpRequest | null>(null)
  const [folderSearch, setFolderSearch] = useState<FolderSearchQuery | null>(null)
  const commandId = useRef(0)
  const bootstrap = useRef<Promise<Result<BootstrapData>> | null>(null)
  const saveAllInProgress = useRef(false)
  const current = documents.active
  const customStyle = useMemo(() => { try { return articleCss(preferences.customCss) } catch { return '' } }, [preferences.customCss])
  useEffect(() => setSelection({ text: '', from: 0, to: 0 }), [current?.id])
  const issueEditorCommand = useCallback((action: EditorAction, value?: string) => {
    setEditorCommand({ id: ++commandId.current, action, value })
  }, [])
  const jumpToLine = useCallback((line: number, documentId = current?.id) => setJumpRequest({ id: ++commandId.current, line, documentId }), [current?.id])
  const activePath = current?.path ?? null
  const resolveResource = useCallback(async (source: string) => {
    const result = await api.resolveResource(source, activePath)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }, [api, activePath])

  useEffect(() => {
    let active = true
    if (!bootstrap.current) bootstrap.current = api.bootstrap()
    void bootstrap.current.then(async result => {
      if (!active) return
      if (!result.ok) { reportError(result.error.message); setIsLoading(false); return }
      loadPreferences(result.data.preferences, result.data.preferencesVersion)
      setPlatform(result.data.platform)
      setRecentFiles(result.data.recentFiles)
      setRecentFolders(result.data.recentFolders ?? [])
      setDrafts(result.data.drafts)
      if (result.data.workspace) { workspaceRef.current = result.data.workspace; setWorkspace(result.data.workspace) }
      result.data.documents.forEach(record => documents.addDocument(record))
      if (!result.data.documents.length) await documents.create()
      if (active) {
        setIsLoading(false)
        if (result.data.drafts.length) setModal('recovery')
      }
    }).catch((failure: unknown) => { if (active) { reportError(failure instanceof Error ? failure.message : translate(localeRef.current, '启动失败')); setIsLoading(false) } })
    return () => { active = false }
  }, [api, documents.addDocument, documents.create, loadPreferences, reportError])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = preferences.locale
    document.title = `${current && isDirty(current) ? '• ' : ''}${current?.name ?? t('未命名')} — QTypora`
  }, [theme, preferences.locale, current?.name, current?.content, current?.savedContent])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!preferences.autoSave) return
    const timer = setInterval(() => {
      for (const item of documents.documentsRef.current) {
        if (item.path && !item.readOnly && !item.isSaving && !item.externalChange && isDirty(item)) run(documents.save(false, item.id))
      }
    }, preferences.autoSaveSeconds * 1000)
    return () => clearInterval(timer)
  }, [preferences.autoSave, preferences.autoSaveSeconds, documents.documentsRef, documents.save, run])

  const refreshWorkspace = async () => {
    const existing = workspaceRef.current
    if (!existing) return
    const entries = documents.acceptResult(await api.readDirectory(existing.path, preferencesRef.current.workspace))
    if (!entries || workspaceRef.current?.path !== existing.path) return
    const next = { ...existing, entries }
    workspaceRef.current = next; setWorkspace(next); setRefreshVersion(value => value + 1)
  }

  const openFolder = async (path?: string) => {
    const sidebarAtStart = preferencesRef.current.sidebarMode
    const folder = documents.acceptResult(await api.openFolder(path))
    if (!folder) return
    workspaceRef.current = folder; setWorkspace(folder)
    setRecentFolders(existing => [folder.path, ...existing.filter(path => path !== folder.path)].slice(0, 20))
    if (preferencesRef.current.sidebarMode === sidebarAtStart) updatePreferences({ sidebarMode: 'files', showSidebar: true })
  }

  const openFile = async (path?: string, line?: number) => {
    const opened = await documents.open(path)
    if (path) setRecentFiles(existing => [path, ...existing.filter(item => item.toLowerCase() !== path.toLowerCase())].slice(0, 30))
    if (opened && line) jumpToLine(line, opened.id)
    return opened
  }

  const save = async (saveAs = false) => {
    if (await documents.save(saveAs)) {
      setNotice(currentT('文档已保存'))
      const saved = documents.documentsRef.current.find(item => item.id === current?.id)
      if (saved?.path) setRecentFiles(existing => [saved.path!, ...existing.filter(item => item !== saved.path)].slice(0, 30))
    }
  }

  const saveAll = async () => {
    if (saveAllInProgress.current) return
    saveAllInProgress.current = true
    let savedCount = 0
    try {
      const ids = documents.documentsRef.current.filter(isDirty).map(item => item.id)
      for (const id of ids) {
        const item = documents.documentsRef.current.find(document => document.id === id)
        if (!item || !isDirty(item)) continue
        if (!await documents.save(false, id)) {
          setNotice(preferencesRef.current.locale === 'en-US' ? `Save All stopped · ${savedCount} saved; remaining edits are preserved` : `保存全部已停止 · 已保存 ${savedCount} 篇，其他编辑仍然保留`)
          return
        }
        savedCount++
      }
      const remaining = documents.documentsRef.current.filter(isDirty).length
      setNotice(preferencesRef.current.locale === 'en-US' ? `Saved ${savedCount} document(s)${remaining ? ` · ${remaining} still contain new edits` : ''}` : `已保存 ${savedCount} 篇${remaining ? ` · 仍有 ${remaining} 篇包含新的编辑` : ''}`)
    } finally { saveAllInProgress.current = false }
  }

  const exportDocument = async (kind: ExportFormat, reusePrevious = false, overwritePrevious = false, print = false) => {
    const item = documents.documentsRef.current.find(document => document.id === current?.id)
    if (!item) return
    await documents.flushSync()
    if (!await flushPreferences()) return
    const plan = documents.acceptResult(await api.getExportPlan({ id: item.id, kind, reusePrevious }))
    if (!plan) return
    const exportPreferences = { ...preferencesRef.current, export: plan.options }
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const remoteImages = new Map<string, Promise<string>>()
    let remoteBytes = 0
    let remoteTail: Promise<unknown> = Promise.resolve()
    const html = !plan.requiresHtml ? undefined : await renderExportDocument(item.content, { locale: exportPreferences.locale, theme: exportTheme(exportPreferences, systemDark), exportCss: exportAppearance(exportPreferences, systemDark), markdownOptions: exportPreferences.markdown, resolveResource: async source => {
      if (/^https?:/i.test(source)) {
        if (!remoteImages.has(source)) {
          if (remoteImages.size >= 20) throw new Error(currentT('单次导出最多下载 20 张远程图片，请先整理资源。'))
          const download = remoteTail.then(async () => {
            if (remoteBytes >= 32 * 1024 * 1024) throw new Error(currentT('远程图片总大小超过 32 MB，请先整理资源。'))
            const result = await api.resolveExportImage({ id: item.id, source })
            if (!result.ok) throw new Error(result.error.message)
            remoteBytes += Math.ceil(result.data.length * 0.75)
            if (remoteBytes > 32 * 1024 * 1024) throw new Error(currentT('远程图片总大小超过 32 MB，请先整理资源。'))
            return result.data
          })
          remoteTail = download
          remoteImages.set(source, download)
        }
        return remoteImages.get(source)!
      }
      const result = await api.resolveResource(source, item.path)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, embedImages: true })
    if (print) {
      const printed = documents.acceptResult(await api.printDocument({ id: item.id, revision: item.revision, preferencesVersion: plan.preferencesVersion, kind, html }))
      if (printed) setNotice(currentT('已发送到打印机'))
    } else {
      const path = documents.acceptResult(await api.exportDocument({ id: item.id, revision: item.revision, preferencesVersion: plan.preferencesVersion, historyVersion: plan.historyVersion, kind, html, reusePrevious, overwritePrevious }))
      if (path) setNotice(`${currentT('已导出：')}${path}`)
    }
  }

  const importExportPresets = async (presets: SavedExportPreset[], strategy: PresetConflictStrategy) => {
    if (!await flushPreferences()) throw new Error(currentT('当前设置未能保存，请解决错误后重新导入预设。'))
    const result = await api.applyExportPresetImport(presets, strategy)
    if (!result.ok) throw new Error(result.error.message)
    loadPreferences(result.data.preferences, result.data.version)
  }

  const insertImage = async () => {
    if (!current) return
    await documents.flushSync()
    const revision = current.revision
    const markdown = documents.acceptResult(await api.insertImage(current.id))
    if (!markdown) return
    if (!documents.documentsRef.current.some(item => item.id === current.id && item.revision === revision)) {
      setNotice(currentT('图片已复制。原文档已关闭，未插入图片引用。'))
      return
    }
    documents.activate(current.id)
    issueEditorCommand('image', markdown)
  }

  const openLink = (target: string) => {
    if (/^(https?:|mailto:)/i.test(target)) { run(api.openExternal(target).then(documents.acceptResult)); return }
    if (target.startsWith('#')) {
      const heading = resolveHeading(current?.content ?? '', target.slice(1), preferences.markdown) ?? resolveMathLabel(current?.content ?? '', target, preferences.markdown) ?? resolveFootnote(current?.content ?? '', target, preferences.markdown) ?? resolveExplicitAnchor(current?.content ?? '', target, preferences.markdown)
      if (heading) jumpToLine(typeof heading === 'number' ? heading : heading.line)
      else reportError(currentT('没有找到链接对应的标题。'))
      return
    }
    if (!current) return
    run((async () => {
      const result = await documents.openLinked(current.id, target)
      const opened = result?.document
      const fragment = result?.fragment
      if (opened && fragment) {
        const heading = resolveHeading(opened.content, fragment, preferences.markdown)
        const line = heading?.line ?? resolveMathLabel(opened.content, '#' + fragment, preferences.markdown) ?? resolveFootnote(opened.content, '#' + fragment, preferences.markdown) ?? resolveExplicitAnchor(opened.content, fragment, preferences.markdown)
        if (line) jumpToLine(line, opened.id)
        else reportError(currentT('目标文档中没有找到此锚点。'))
      }
    })())
  }

  const executeCommand = async (command: AppCommand) => {
    // Electron accelerators arrive through IPC before DOM keyboard handlers can stop them.
    if (document.querySelector('.editor-resource-viewer') && command !== 'request-window-close') return
    const options = preferencesRef.current
    switch (command) {
      case 'new': await documents.create(); break
      case 'new-window': documents.acceptResult(await api.newWindow()); break
      case 'open': await openFile(); break
      case 'open-folder': await openFolder(); break
      case 'insert-image': {
        if (!modal && !fileAction && !reloadId && document.activeElement?.closest('.cm-content') && !current?.readOnly) await insertImage()
        break
      }
      case 'save': await save(); break
      case 'save-all': await saveAll(); break
      case 'save-as': await save(true); break
      case 'close-document': await documents.close(); break
      case 'request-window-close': if (await flushPreferences()) await documents.requestClose(); break
      case 'undo':
      case 'redo': {
        const focused = document.activeElement
        if (focused?.closest('.cm-content')) issueEditorCommand(command)
        else if (focused instanceof HTMLTextAreaElement ||
          (focused instanceof HTMLInputElement && ['text', 'search', 'url', 'email', 'password', 'tel', 'number'].includes(focused.type)) ||
          (focused instanceof HTMLElement && focused.isContentEditable && !focused.closest('.markdown-editor'))) {
          // Chromium keeps its own history for ordinary controls; CodeMirror owns article history.
          document.execCommand(command)
        }
        break
      }
      case 'find': issueEditorCommand('find'); break
      case 'replace': issueEditorCommand('replace'); break
      case 'quick-open': setModal('quick-open'); break
      case 'preferences': setModal('preferences'); break
      case 'source': updatePreferences({ sourceMode: !options.sourceMode, readingMode: false }); break
      case 'reading':
      case 'select-scope': {
        if (!modal && !fileAction && !reloadId && document.activeElement?.closest('.cm-content, [data-testid="live-table"]')) issueEditorCommand('select-scope')
        break
      }
      case 'sidebar': updatePreferences({ showSidebar: !options.showSidebar }); break
      case 'outline': updatePreferences({ sidebarMode: 'outline', showSidebar: true }); break
      case 'files': updatePreferences({ sidebarMode: 'files', showSidebar: true }); break
      case 'search-folder': updatePreferences({ sidebarMode: 'search', showSidebar: true }); break
      case 'focus': updatePreferences({ focusMode: !options.focusMode }); break
      case 'typewriter': updatePreferences({ typewriterMode: !options.typewriterMode }); break
      case 'toolbar': updatePreferences({ showToolbar: !options.showToolbar }); break
      case 'organize-images': await documents.flushSync(); if (await flushPreferences()) issueEditorCommand('organize-images'); break
      case 'upload-images': await documents.flushSync(); if (await flushPreferences()) issueEditorCommand('upload-images'); break
      case 'export-options': setModal('export'); break
      case 'export-previous': await exportDocument('html', true); break
      case 'export-overwrite': await exportDocument('html', true, true); break
      case 'print': await exportDocument('pdf', false, false, true); break
      case 'import': await documents.importFile(); break
      case 'statistics': document.querySelector<HTMLButtonElement>('[data-testid=word-count]')?.click(); break
      case 'export-html': await exportDocument('html'); break
      case 'export-pdf': await exportDocument('pdf'); break
      case 'zoom-in': { const zoomFactor = Math.min(2, Math.round((options.zoomFactor + 0.1) * 10) / 10); updatePreferences({ zoomFactor }); documents.acceptResult(await api.setZoomFactor(zoomFactor)); break }
      case 'zoom-out': { const zoomFactor = Math.max(0.5, Math.round((options.zoomFactor - 0.1) * 10) / 10); updatePreferences({ zoomFactor }); documents.acceptResult(await api.setZoomFactor(zoomFactor)); break }
      case 'zoom-reset': updatePreferences({ zoomFactor: 1 }); documents.acceptResult(await api.setZoomFactor(1)); break
      case 'recover-drafts': {
        const result = documents.acceptResult(await api.bootstrap())
        if (result) setDrafts(result.drafts)
        setModal('recovery'); break
      }
      case 'next-document': documents.nextDocument(); break
    }
  }
  const commandHandler = useRef(executeCommand)
  commandHandler.current = executeCommand
  const refreshHandler = useRef(refreshWorkspace)
  refreshHandler.current = refreshWorkspace

  useEffect(() => api.onEvent(event => {
    if (event.type === 'command') run(commandHandler.current(event.command))
    else if (event.type === 'open-document') documents.addDocument(event.document)
    else if (event.type === 'document-changed') documents.externalChange(event.id, event.kind)
    else if (event.type === 'document-renamed') documents.renamed(event.id, event.path, event.name)
    else if (event.type === 'workspace-changed') run(refreshHandler.current())
  }), [api, documents.addDocument, documents.externalChange, documents.renamed, run])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const command = shortcutCommandForEvent(event, platform, preferencesRef.current.shortcuts)
      if (command === 'insert-image' || command === 'select-scope') {
        if (modal || fileAction || reloadId || !document.activeElement?.closest('.cm-content')) return
      }
      if (command) { event.preventDefault(); run(commandHandler.current(command)) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [run, modal, fileAction, reloadId, platform])

  const performFileAction = async (name: string) => {
    if (!fileAction || fileActionInProgress.current) return
    const target = fileAction.contextTarget
    if (target && !isFileContextScopeCurrent(target, workspaceRef.current, documents.documentsRef.current)) {
      setFileAction(null); reportError(currentT('目录或目标文件已更改，请重新选择文件操作。')); return
    }
    fileActionInProgress.current = true; setIsFileActionPending(true)
    try {
      const result = await api.fileAction({ action: fileAction.action, path: fileAction.path, ...(fileAction.action !== 'trash' ? { name } : {}) })
      if (!result.ok) { reportError(result.error.message); return }
      setFileAction(null)
      if (target && (target.workspacePath ?? null) !== (workspaceRef.current?.path ?? null)) return
      await refreshWorkspace()
      if (result.data?.kind === 'file' && fileAction.action === 'create-file') await openFile(result.data.path)
    } finally { fileActionInProgress.current = false; setIsFileActionPending(false) }
  }

  const appStyle = { '--writing-line-height': preferences.lineHeight, ...(preferences.fontFamily ? { '--font-editor': preferences.fontFamily } : {}), '--content-width': preferences.contentWidthMode === 'auto' ? '100%' : `${preferences.contentWidth}px` } as CSSProperties
  if (isLoading) return <div className="startup-state"><FileText size={32} /><p>{t('正在打开写作空间…')}</p></div>

  return <LocaleProvider locale={preferences.locale}><div className={`desktop-app ${preferences.sourceMode ? 'source-mode' : 'hybrid-mode'}`} style={appStyle} data-testid="desktop-app" data-theme={theme} data-palette={theme === 'dark' ? preferences.darkTheme : preferences.lightTheme}>
    {customStyle ? <style>{customStyle}</style> : null}
    {platform === 'darwin' ? <div className="mac-titlebar" data-testid="mac-titlebar"><span>{current?.name ?? 'QTypora'}</span></div> : null}
    <Toolbar platform={platform} showFormatting={preferences.showToolbar} sourceMode={preferences.sourceMode} disabled={!current || current.readOnly} isSaving={current?.isSaving ?? false} onAction={issueEditorCommand} onNew={() => run(executeCommand('new'))} onOpen={() => run(executeCommand('open'))} onSave={() => run(save())} onSaveAll={() => run(saveAll())} onSidebar={() => run(executeCommand('sidebar'))} onSource={() => run(executeCommand('source'))} onQuickOpen={() => setModal('quick-open')} onPreferences={() => setModal('preferences')} onOpenFolder={() => run(openFolder())} onExport={kind => run(exportDocument(kind))} onImage={() => run(insertImage())} onCloseDocument={() => run(documents.close())} onSaveAs={() => run(save(true))} onRecovery={() => run(executeCommand('recover-drafts'))} onNewWindow={() => run(executeCommand('new-window'))} focusMode={preferences.focusMode} typewriterMode={preferences.typewriterMode} onFocus={() => run(executeCommand('focus'))} onTypewriter={() => run(executeCommand('typewriter'))} isContentConstrained={preferences.contentWidthMode === 'fixed'} onContentWidthToggle={() => updatePreferences({ contentWidthMode: preferencesRef.current.contentWidthMode === 'fixed' ? 'auto' : 'fixed' })} />
    <div className="writing-space">
      {preferences.showSidebar ? <Sidebar recentFolders={recentFolders} markdownOptions={preferences.markdown} workspaceOptions={preferences.workspace} onWorkspaceOptionsChange={workspace => updatePreferences({ workspace })} currentLine={(current?.content.slice(0, selection.from).split('\n').length) ?? 1} api={api} mode={preferences.sidebarMode} workspace={workspace} documents={documents.documents} current={current} refreshVersion={refreshVersion} onMode={mode => updatePreferences({ sidebarMode: mode })} onOpenFolder={path => run(openFolder(path))} onOpen={(path, line) => run(openFile(path, line))} onActivate={documents.activate} onJump={jumpToLine} onFileAction={setFileAction} onError={reportError} onRefresh={() => run(refreshWorkspace())} onSearchChange={setFolderSearch} /> : null}
      <main className="document-pane">
        <div className="document-heading"><span className="document-name" data-testid="document-name">{current?.name ?? t('未命名')}</span>{current && isDirty(current) ? <span className="dirty-label" data-testid="dirty-indicator">{t('未保存')}</span> : null}{current?.readOnly ? <span className="dirty-label">{t('只读')}</span> : null}<span className="document-heading-spacer" /><button className="document-path" title={current?.path ?? t('尚未保存到文件')} disabled={!current?.path} onClick={() => { if (current?.path) run(api.revealFile(current.path).then(documents.acceptResult)) }}>{current?.path ? <><FolderOpen size={12} />{current.path}</> : t('Markdown 文档')}</button></div>
        {current?.externalChange ? <div className="external-change"><AlertCircle size={16} /><span>{current.externalChange === 'removed' ? t('文件已被移动或删除。可另存为保留当前编辑。') : t('磁盘上的文件已更改，当前编辑仍然保留。')}</span>{current.externalChange === 'changed' ? <button className="text-button" onClick={() => setReloadId(current.id)}>{t('重新载入')}</button> : null}<button className="text-button" onClick={() => run(save(true))}>{t('另存为')}</button></div> : null}
        <div className="editor-area">{current ? <FloatingToolbar key={current.id} enabled={preferences.floatingToolbar} documentId={current.id} selection={selection} readOnly={current.readOnly} onAction={issueEditorCommand} /> : null}{current ? <MarkdownEditor locale={preferences.locale} markdownOptions={preferences.markdown} imageOptions={preferences.image} platform={platform} desktopApi={api} documentId={current.id} revision={current.revision} value={current.content} mode={preferences.sourceMode ? 'source' : 'hybrid'} theme={theme} fontSize={preferences.fontSize} focusMode={preferences.focusMode} typewriterMode={preferences.typewriterMode} readOnly={current.readOnly} lineNumbers={preferences.showLineNumbers} wrapLines={preferences.wrapLines} spellcheck={preferences.spellcheck} command={editorCommand} jumpToLine={jumpRequest} folderSearch={folderSearch} onChange={value => documents.changeContent(current.id, value)} onSelectionChange={setSelection} onLinkOpen={openLink} resolveResource={resolveResource} /> : <div className="startup-state"><p>{t('开始写下第一个想法。')}</p><button className="primary-button" onClick={() => run(documents.create())}>{t('新建文档')}</button></div>}</div>
      </main>
    </div>
    <footer className="statusbar"><div className="statusbar-left" role="status" aria-live="polite">{current?.isSaving ? t('正在保存…') : notice ? <><Check size={12} />{notice}</> : current && isDirty(current) ? t('编辑中 · 草稿独立保存') : current?.path ? t('已保存') : t('尚未保存')}{preferences.focusMode ? <span>{t('专注')}</span> : null}{preferences.typewriterMode ? <span>{t('打字机')}</span> : null}</div><div className="statusbar-right"><span>{current?.encoding === 'utf8-bom' ? 'UTF-8 BOM' : 'UTF-8'}</span><span>{current?.lineEnding ?? preferences.lineEnding}</span><button data-testid="editor-mode" title={`${t('切换源码模式')} · ${primaryShortcut(platform, '/')}`} onClick={() => run(executeCommand('source'))}>{preferences.sourceMode ? t('源码模式') : t('实时预览')}</button><WordStatistics unit={preferences.statisticsUnit} onUnitChange={statisticsUnit => updatePreferences({ statisticsUnit })} content={current?.content ?? ''} selectedText={selection.text} readingSpeed={preferences.readingSpeed} markdownOptions={preferences.markdown} /></div></footer>
    {error ? <div className="error-notification" role="alert" data-testid="error-notification"><AlertCircle size={17} /><span>{error}</span><button className="icon-button" aria-label={t('关闭错误提示')} onClick={() => setError(null)}><X size={16} /></button></div> : null}
    {modal === 'export' ? <ExportDialog desktopApi={api} options={preferences.export} onImportPresets={importExportPresets} onOptionsChange={options => updatePreferences({ export: options })} onExport={async format => { try { await exportDocument(format) } catch (error) { reportError(error instanceof Error ? error.message : currentT('导出失败')) } }} onSettings={() => setModal('preferences')} onClose={() => setModal(null)} /> : null}
    {modal === 'preferences' ? <PreferencesDialog desktopApi={api} platform={platform} preferences={preferences} onChange={updatePreferences} onClose={() => { run(flushPreferences().then(saved => { if (saved) setModal(current => current === 'preferences' ? null : current) })) }} /> : null}
    {modal === 'quick-open' ? <QuickOpen api={api} workspace={workspace} documents={documents.documents} recentFiles={recentFiles} onSelectDocument={documents.activate} onOpenFile={path => run(openFile(path))} onClose={() => setModal(null)} /> : null}
    {modal === 'recovery' ? <DraftRecovery drafts={drafts} onRecover={id => run(documents.recover(id).then(accepted => { if (accepted) { setDrafts(existing => existing.filter(item => item.id !== id)); setModal(null); setNotice(currentT('草稿已恢复，请保存文档')) } }))} onDiscard={id => run(api.discardDraft(id).then(result => { if (result.ok) setDrafts(existing => existing.filter(item => item.id !== id)); else reportError(result.error.message) }))} onClose={() => setModal(null)} /> : null}
    {fileAction ? <FileActionDialog action={fileAction} isSubmitting={isFileActionPending} onSubmit={name => run(performFileAction(name))} onClose={() => { if (!fileActionInProgress.current) setFileAction(null) }} /> : null}
    {reloadId ? <Dialog title={t('重新载入文件')} onClose={() => setReloadId(null)}><div className="dialog-content"><p>{t('重新载入会用磁盘内容替换当前文档的编辑。请先另存需要保留的内容。')}</p></div><div className="dialog-footer"><button className="text-button" onClick={() => setReloadId(null)}>{t('取消')}</button><button className="primary-button" onClick={() => { const id = reloadId; setReloadId(null); run(documents.reload(id)) }}>{t('重新载入')}</button></div></Dialog> : null}
  </div></LocaleProvider>
}
