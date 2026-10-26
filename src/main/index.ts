import { watch, type FSWatcher } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, Menu, nativeImage, protocol, session, shell, type IpcMainInvokeEvent } from 'electron'
import type { AppCommand, DesktopEvent, ExportRequest, FileAction, FileEntry, Preferences, SaveRequest, SearchRequest, Workspace } from '../shared/contracts'
import { DocumentSession, validateSnapshot } from './documents'
import { boolean, DesktopError, failure, invalid, object, string } from './errors'
import { getExportPlan, exportDocument, printDocument } from './exports'
import { importExportPresets, exportExportPresets } from './export-preset-files'
import { EXPORT_FORMATS, type SavedExportPreset } from '../shared/export-options'
import { createExportPresetFile, mergeImportedExportPresets } from '../shared/export-preset-file'
import { normalizeWorkspaceOptions } from '../shared/workspace-options'
import { organizeImages, importImages, importImageFiles, validateImageImport } from './image-import'
import { openLinkedFile } from './linked-files'
import { withEmbeddedImportMedia } from './pandoc-import-media'
import { PANDOC_IMPORT_FORMATS, runPandoc } from './pandoc'
import { canonicalInside, canonicalPath, IMAGE_MIME, listDirectory, MARKDOWN_EXTENSIONS, MAX_DOCUMENT_BYTES, safeName, serialized, searchMarkdown } from './files'
import { LocalStore, validatePreferences } from './preferences'
import { ResourceRegistry } from './resources'
import { createMenuTemplate } from './menu'
import { markdownImageSources, missingImagesAfterSaveAs } from './image-paths'
import { NativeContextMenus, validateContextMenu } from './context-menu'
import { validateClipboard } from './clipboard'
import { operateImage, validateImageOperation } from './image-operations'
import { resourceBytes, validateResourceSave, writeResource } from './resource-save'
import { mergePreferencePatch } from '../shared/preference-patch'
import { downloadRemoteImage } from './image-download'
import { learnSpelling, forgetSpelling, listSpellingWords } from './spelling'
import { configureWindowsJumpList, rememberSystemDocument } from './platform-integration'
import { helpText, diagnosticsText } from './app-help'
import { showThirdPartyNotices } from './notices'
import { OpenFileQueue } from './open-files'
import { FileMoveHistory } from './file-history'
import { readFileSnapshot } from './file-snapshot'
import { normalizedImageSource, uploadImages, validateUploadImages } from './image-uploader'

app.setName('QTypora')
if (process.platform === 'win32') app.setAppUserModelId('com.qtypora.internal')
if (process.env.QTYPORA_TEST_USER_DATA) {
  if (!path.isAbsolute(process.env.QTYPORA_TEST_USER_DATA)) throw new Error('QTYPORA_TEST_USER_DATA must be an absolute directory')
  app.setPath('userData', process.env.QTYPORA_TEST_USER_DATA)
}
protocol.registerSchemesAsPrivileged([{ scheme: 'qtypora-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

interface WindowContext {
  window: BrowserWindow
  documents: DocumentSession
  fileMoves: FileMoveHistory
  approvedClose: boolean
  closing: boolean
  closeCheckPending: boolean
  workspaceWatcher?: FSWatcher
  workspaceTimer?: ReturnType<typeof setTimeout>
}

const windows = new Map<number, WindowContext>()
const resources = new ResourceRegistry()
const contextMenus = new NativeContextMenus((template) => Menu.buildFromTemplate(template))
let store: LocalStore
let preferencesVersion = 0
const systemOpenFiles = new OpenFileQueue(openSystemFile, (error) => {
  const context = focused()
  if (context) void showFailure(context, error)
  else console.error('[app] File open failed', error instanceof Error ? error.message : 'unknown')
})
if (process.platform === 'darwin') app.on('open-file', (event, filePath) => {
  event.preventDefault()
  void systemOpenFiles.enqueue(filePath)
})
const rendererPath = path.join(__dirname, '../renderer/index.html')
const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'branding/icon.png')
  : path.join(app.getAppPath(), 'build/icon-512.png')
const markdownFilters = [{ name: 'Markdown 与文本', extensions: [...MARKDOWN_EXTENSIONS].map((extension) => extension.slice(1)) }]

function send(context: WindowContext, event: DesktopEvent): void {
  if (!context.window.isDestroyed() && !context.window.webContents.isDestroyed()) context.window.webContents.send('qtypora:event', event)
}

function focused(): WindowContext | undefined {
  const window = BrowserWindow.getFocusedWindow()
  return window ? windows.get(window.webContents.id) : [...windows.values()][0]
}

function command(command: AppCommand): void {
  const context = focused()
  if (context) send(context, { type: 'command', command })
}

function applySpellingPreferences(): void {
  session.defaultSession.setSpellCheckerEnabled(store.preferences.spellcheck)
  if (process.platform !== 'darwin') {
    const available = session.defaultSession.availableSpellCheckerLanguages
    session.defaultSession.setSpellCheckerLanguages(store.preferences.spellcheckLanguages.filter(language => available.includes(language)))
  }
}

function createMenus(): void {
  const template = createMenuTemplate(process.platform, app.isPackaged, store.recentFiles, {
    command,
    openRecent: (filePath) => {
      const context = focused()
      if (context) void context.documents.open(filePath).then((document) => send(context, { type: 'open-document', document })).catch((error: unknown) => showFailure(context, error))
    },
    exit: () => focused()?.window.close(),
    thirdPartyNotices: () => { const context = focused(); if (context) void showThirdPartyNotices(context.window, path.join(__dirname, '../renderer/third-party-notices.txt')).catch(error => showFailure(context, error)) },
    checkUpdates: () => { void shell.openExternal('https://github.com/sleepdecidehair/qtypora/releases') },
    help: () => { const context = focused(); if (context) void dialog.showMessageBox(context.window, { type: 'info', title: 'QTypora 使用帮助', message: '本地 Markdown 编辑器', detail: helpText(process.platform) }) },
    diagnostics: () => { const context = focused(); if (context) void dialog.showMessageBox(context.window, { type: 'info', title: '应用诊断', message: 'QTypora 运行环境', detail: diagnosticsText({ applicationVersion: app.getVersion(), platform: process.platform, architecture: process.arch, electronVersion: process.versions.electron, chromiumVersion: process.versions.chrome, nodeVersion: process.versions.node, packaged: app.isPackaged, spellcheckEnabled: store.preferences.spellcheck, spellcheckLanguages: store.preferences.spellcheckLanguages }) }) },
    about: () => {
      const window = focused()?.window
      if (window) void dialog.showMessageBox(window, { type: 'info', title: '关于 QTypora', message: app.isPackaged ? 'QTypora 内测版' : 'QTypora 开发版', icon: appIconPath, detail: `版本 ${app.getVersion()}\n本地 Markdown 桌面编辑器\nElectron ${process.versions.electron}` })
    },
  }, { shortcuts: store.preferences.shortcuts })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function showFailure(context: WindowContext, error: unknown): Promise<void> {
  const result = failure(error)
  if (!result.ok && !context.window.isDestroyed()) await dialog.showMessageBox(context.window, { type: 'error', message: result.error.message })
}

async function openSystemFile(filePath: string): Promise<void> {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new DesktopError('UNSUPPORTED', '仅支持打开 Markdown 或 UTF-8 文本文件。')
  const context = focused()
  if (!context) { await createWindow(filePath); return }
  const document = await context.documents.open(filePath, true)
  createMenus()
  send(context, { type: 'open-document', document })
  if (context.window.isMinimized()) context.window.restore()
  context.window.show()
  context.window.focus()
}

async function createWindow(openPath?: string): Promise<void> {
  const window = new BrowserWindow({ width: 1220, height: 860, minWidth: 760, minHeight: 560, show: false,
    title: 'QTypora', icon: appIconPath, backgroundColor: '#ffffff', autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, spellcheck: store.preferences.spellcheck, allowRunningInsecureContent: false },
  })
  const owner = window.webContents.id
  let context: WindowContext
  const documents = new DocumentSession(store, {
    chooseSave: async (record) => {
      const selected = await dialog.showSaveDialog(window, { title: '保存 Markdown', defaultPath: record.path ?? record.name, filters: markdownFilters,
        properties: ['showOverwriteConfirmation', 'createDirectory'] })
      if (selected.canceled || !selected.filePath) return null
      if (!MARKDOWN_EXTENSIONS.has(path.extname(selected.filePath).toLowerCase())) throw new DesktopError('UNSUPPORTED', '请使用 .md、.markdown 或 .txt 扩展名。')
      const missingImages = await missingImagesAfterSaveAs(record.content, record.path, selected.filePath)
      if (missingImages.length) {
        const answer = await dialog.showMessageBox(window, { type: 'warning', title: '另存为后的图片路径',
          message: `另存后有 ${missingImages.length} 张相对路径图片在目标目录中找不到。`,
          detail: `以下引用仍按原文保留：\n${missingImages.slice(0, 5).join('\n')}\n\n继续后请将图片复制到目标目录中的相同位置，或修改图片引用。原图片不会移动或删除。`,
          buttons: ['继续另存', '取消'], defaultId: 1, cancelId: 1, noLink: true })
        if (answer.response !== 0) return null
      }
      return selected.filePath
    },
    confirmClose: async (record) => {
      const answer = await dialog.showMessageBox(window, { type: 'question', title: '保存修改', message: `是否保存“${record.name}”的修改？`,
        detail: '保存后关闭；选择“不保存”将丢弃本次修改。', buttons: ['保存', '不保存', '取消'], defaultId: 0, cancelId: 2, noLink: true })
      return answer.response === 0 ? 'save' : answer.response === 1 ? 'discard' : 'cancel'
    },
  }, (event) => send(context, event))
  const fileMoves = new FileMoveHistory({
    withDocumentLocks: (source, operation) => {
      const sessions = [...windows.values()].sort((a, b) => a.window.id - b.window.id).map(target => target.documents)
      const lock = (index: number): ReturnType<typeof operation> => index === sessions.length ? operation() : sessions[index].withPathLocks(source, () => lock(index + 1))
      return lock(0)
    },
    updatePaths: async (source, destination) => { for (const target of windows.values()) await target.documents.updatePaths(source, destination) },
  })
  context = { window, documents, fileMoves, approvedClose: false, closing: false, closeCheckPending: false }
  windows.set(owner, context)
  if (openPath) {
    try {
      if ((await fs.stat(openPath)).isDirectory()) await openWorkspace(context, openPath, true)
      else await context.documents.open(openPath, true)
    }
    catch (error) { console.error('[app] Command-line file could not be opened'); await showFailure(context, error) }
  }
  if (!context.documents.records().length) context.documents.create('# 欢迎使用 QTypora\n\n默认实时预览，直接点击文字继续编辑。\n\n## 从这里开始\n\n- 按 **Ctrl + N** 新建文档\n- 按 **Ctrl + O** 打开 Markdown 文件\n- 按 **Ctrl + S** 保存\n- 按 **Ctrl + /** 在实时预览与源码模式之间切换\n- 按 **Ctrl + E** 选中当前格式范围或表格单元格\n\n> 文档保存在你的电脑上；草稿会独立恢复。\n\n```typescript\nconst message = "开始写作"\nconsole.log(message)\n```\n')
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.on('close', (event) => {
    if (context.approvedClose) return
    event.preventDefault()
    if (!context.closing) { context.closing = true; send(context, { type: 'command', command: 'request-window-close' }) }
  })
  window.on('closed', () => {
    contextMenus.cancel(window)
    context.documents.dispose()
    context.workspaceWatcher?.close()
    if (context.workspaceTimer) clearTimeout(context.workspaceTimer)
    resources.dispose(owner)
    windows.delete(owner)
  })
  window.once('ready-to-show', () => { window.webContents.setZoomFactor(store.preferences.zoomFactor); window.show() })
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(rendererUrl)
  else await window.loadFile(rendererPath)
}

function trustedContext(event: IpcMainInvokeEvent): WindowContext {
  const context = windows.get(event.sender.id)
  if (!context || context.window.isDestroyed() || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== event.sender.getURL()) throw new DesktopError('PERMISSION_DENIED', '不可信的桌面通信来源。')
  const current = new URL(event.senderFrame.url)
  const expected = new URL(rendererUrl)
  if (current.protocol !== expected.protocol || current.host !== expected.host || current.pathname !== expected.pathname) throw new DesktopError('PERMISSION_DENIED', '该页面没有桌面访问权限。')
  return context
}

function handle(name: string, operation: (context: WindowContext, ...args: unknown[]) => Promise<unknown> | unknown): void {
  ipcMain.handle(`qtypora:${name}`, async (event, ...args: unknown[]) => {
    try { return { ok: true, data: await operation(trustedContext(event), ...args) } }
    catch (error) { return failure(error) }
  })
}

function watchWorkspace(context: WindowContext): void {
  context.workspaceWatcher?.close()
  if (context.workspaceTimer) clearTimeout(context.workspaceTimer)
  const directory = context.documents.workspace
  if (!directory) return
  try {
    context.workspaceWatcher = watch(directory, { recursive: process.platform === 'win32' || process.platform === 'darwin', persistent: false }, () => {
      if (context.workspaceTimer) clearTimeout(context.workspaceTimer)
      context.workspaceTimer = setTimeout(() => send(context, { type: 'workspace-changed', path: directory }), 250)
    })
    context.workspaceWatcher.on('error', () => console.error('[watch] Workspace watcher unavailable'))
  } catch { console.error('[watch] Workspace watcher unavailable') }
}

async function openWorkspace(context: WindowContext, selected: string, chosenByUser: boolean): Promise<Workspace> {
  const previouslyChosen = store.recentFolders.includes(selected) || store.preferences.workspace.pinnedFolders.includes(selected)
  const root = chosenByUser || previouslyChosen ? await canonicalPath(selected) : await context.documents.authorize(selected)
  if (!(await fs.stat(root)).isDirectory()) invalid('请选择文件夹。')
  const entries = await listDirectory(root, store.preferences.workspace)
  context.documents.allowedRoots.add(root)
  context.documents.workspace = root
  await store.addRecentFolder(root)
  watchWorkspace(context)
  return { path: root, name: path.basename(root), entries }
}

async function fileEntry(filePath: string): Promise<FileEntry> {
  const stat = await fs.stat(filePath)
  return { name: path.basename(filePath), path: filePath, kind: stat.isDirectory() ? 'directory' : 'file', modifiedAt: stat.mtimeMs }
}

async function runFileAction(context: WindowContext, action: FileAction): Promise<FileEntry | null> {
  const root = context.documents.workspace
  if (!root) throw new DesktopError('PERMISSION_DENIED', '请先打开工作区文件夹。')
  const source = await canonicalInside(path.resolve(action.path), root)
  if (source.toLowerCase() === root.toLowerCase() && (action.action === 'rename' || action.action === 'trash')) throw new DesktopError('PERMISSION_DENIED', '不能通过文件树移动或删除工作区根目录。')
  if (action.action === 'trash') {
    const trashName = process.platform === 'darwin' ? '废纸篓' : '回收站'
    const response = await dialog.showMessageBox(context.window, { type: 'warning', title: `移到${trashName}`, message: `将“${path.basename(source)}”移到${trashName}？`,
      detail: `可通过系统${trashName}恢复。已打开文档的编辑内容会保留。`, buttons: [`移到${trashName}`, '取消'], defaultId: 1, cancelId: 1, noLink: true })
    if (response.response !== 0) return null
    await shell.trashItem(source)
    for (const target of windows.values()) await target.documents.updatePaths(source, null)
    send(context, { type: 'workspace-changed', path: root })
    return null
  }
  if (action.action === 'duplicate') {
    const entry = await context.fileMoves.duplicate(root, source)
    send(context, { type: 'workspace-changed', path: root })
    return entry
  }
  if (!action.name) invalid('请提供文件名称。')
  const name = safeName(action.name)
  if (action.action === 'rename') {
    if ((await fs.lstat(source)).isFile()) {
      const renamed = await context.fileMoves.rename(root, source, name)
      send(context, { type: 'workspace-changed', path: root })
      return renamed
    }
    const destination = await canonicalInside(path.join(path.dirname(source), name), root, true)
    try { await fs.lstat(destination); throw new DesktopError('CONFLICT', '目标名称已经存在。') }
    catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
    await fs.rename(source, destination)
    for (const target of windows.values()) await target.documents.updatePaths(source, destination)
    send(context, { type: 'workspace-changed', path: root })
    return fileEntry(destination)
  }
  if (!(await fs.stat(source)).isDirectory()) invalid('请在文件夹内创建文件。')
  const destination = await canonicalInside(path.join(source, name), root, true)
  if (action.action === 'create-folder') await fs.mkdir(destination)
  else {
    if (!MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase())) invalid('文档名称需要 Markdown 或 .txt 扩展名。')
    const created = await context.fileMoves.create(root, source, name)
    send(context, { type: 'workspace-changed', path: root })
    return created
  }
  send(context, { type: 'workspace-changed', path: root })
  return fileEntry(destination)
}

function registerIpc(): void {
  handle('bootstrap', async (context) => ({ preferences: store.preferences, preferencesVersion, recentFiles: store.recentFiles, recentFolders: store.recentFolders, documents: context.documents.records(),
    drafts: [...store.drafts.values()].filter((draft) => ![...windows.values()].some((window) => window.documents.records().some((record) => record.id === draft.id))),
    version: app.getVersion(), platform: process.platform,
    workspace: context.documents.workspace ? { path: context.documents.workspace, name: path.basename(context.documents.workspace), entries: await listDirectory(context.documents.workspace, store.preferences.workspace) } : null }))
  handle('createDocument', (context) => context.documents.create())
  handle('openFile', async (context, input) => {
    let filePath: string
    const chosenByUser = input === undefined
    if (chosenByUser) {
      const response = await dialog.showOpenDialog(context.window, { title: '打开 Markdown', filters: markdownFilters, properties: ['openFile'] })
      if (response.canceled || !response.filePaths[0]) return null
      filePath = response.filePaths[0]
    } else filePath = string(input, '文件路径')
    const record = await context.documents.open(filePath, chosenByUser)
    if (record.path) rememberSystemDocument(app, process.platform, app.isPackaged, record.path)
    createMenus()
    return record
  })
  handle('openLinkedFile', async (context, input) => {
    const result = await openLinkedFile(input, context.documents, {
      confirmCreate: async filePath => (await dialog.showMessageBox(context.window, { type: 'question', title: '创建链接文档', message: `文件不存在，是否创建“${path.basename(filePath)}”？`, detail: filePath, buttons: ['创建', '取消'], defaultId: 1, cancelId: 1 })).response === 0,
      openPath: filePath => shell.openPath(filePath),
    })
    if (result?.document?.path) rememberSystemDocument(app, process.platform, app.isPackaged, result.document.path)
    createMenus()
    return result
  })
  handle('openFolder', async (context, input): Promise<Workspace | null> => {
    if (input !== undefined) return openWorkspace(context, string(input, '文件夹路径'), false)
    const response = await dialog.showOpenDialog(context.window, { title: '打开文件夹', properties: ['openDirectory'] })
    if (response.canceled || !response.filePaths[0]) return null
    return openWorkspace(context, response.filePaths[0], true)
  })
  handle('readDirectory', async (context, input, options) => {
    let workspaceOptions
    try { workspaceOptions = normalizeWorkspaceOptions(options) } catch (error) { invalid(error instanceof Error ? error.message : '文件显示设置无效。') }
    return listDirectory(await context.documents.authorize(string(input, '文件夹路径')), workspaceOptions)
  })
  handle('syncDocument', async (context, input) => context.documents.sync(validateSnapshot(input)))
  handle('saveDocument', async (context, input) => {
    const value = object(input)
    const request: SaveRequest = { ...validateSnapshot(input), saveAs: value.saveAs === undefined ? undefined : boolean(value.saveAs, '另存为') }
    const result = await context.documents.save(request)
    if (result?.path) rememberSystemDocument(app, process.platform, app.isPackaged, result.path)
    createMenus()
    return result
  })
  handle('closeDocument', (context, input) => context.documents.close(validateSnapshot(input)))
  handle('requestWindowClose', async (context, input) => {
    if (context.closeCheckPending) return false
    context.closeCheckPending = true
    try {
      if (!Array.isArray(input) || input.length > 200) invalid('关闭窗口的文档列表无效。')
      const approved = await context.documents.canCloseWindow(input.map(validateSnapshot))
      if (approved) {
        context.approvedClose = true
        setImmediate(() => { if (!context.window.isDestroyed()) context.window.close() })
      }
      return approved
    } finally { context.closeCheckPending = false; context.closing = false }
  })
  handle('reloadDocument', (context, input) => context.documents.reload(string(input, '文档 ID', 100)))
  handle('recoverDraft', async (context, input) => {
    const id = string(input, '草稿 ID', 100)
    if ([...windows.values()].some((window) => window !== context && window.documents.records().some((record) => record.id === id))) throw new DesktopError('CONFLICT', '该草稿正在其他窗口编辑。')
    return context.documents.recover(id)
  })
  handle('discardDraft', async (_context, input) => {
    const id = string(input, '草稿 ID', 100)
    if ([...windows.values()].some((window) => window.documents.records().some((record) => record.id === id))) throw new DesktopError('CONFLICT', '编辑中的文档草稿不能删除。')
    await store.discardDraft(id)
  })
  const applyPreferences = async (context: WindowContext, input: unknown, partial: boolean, derive?: (current: Preferences) => unknown) => serialized('preferences:update', async () => {
    let candidate: unknown
    try {
      candidate = derive ? derive(store.preferences) : input
      if (partial) candidate = mergePreferencePatch(store.preferences, candidate)
    } catch (error) { invalid(error instanceof Error ? error.message : '偏好变更无效。') }
    const validated = validatePreferences(candidate)
    for (const folder of validated.workspace.pinnedFolders) {
      if (store.preferences.workspace.pinnedFolders.includes(folder) || store.recentFolders.includes(folder)) continue
      // A bookmark can retain an existing grant, but a preference patch cannot grant a new root.
      const authorized = await context.documents.authorize(folder)
      if (!(await fs.stat(authorized)).isDirectory()) invalid('固定位置必须是已打开文件夹内的目录。')
    }
    const preferences = await store.updatePreferences(validated)
    const version = ++preferencesVersion
    applySpellingPreferences()
    for (const target of windows.values()) {
      target.window.webContents.setZoomFactor(preferences.zoomFactor)
      send(target, { type: 'preferences-changed', preferences, version })
    }
    createMenus()
    return { preferences, version }
  })
  handle('updatePreferences', async (context, input) => (await applyPreferences(context, input, false)).preferences)
  handle('patchPreferences', (context, input) => applyPreferences(context, input, true))
  handle('applyExportPresetImport', (context, input, strategy) => {
    if (strategy !== 'keep' && strategy !== 'replace') invalid('请选择有效的同名预设处理方式。')
    let presets: SavedExportPreset[]
    try { presets = createExportPresetFile(input).presets }
    catch (error) { invalid(error instanceof Error ? error.message : '导入预设无效。') }
    return applyPreferences(context, {}, true, current => ({ export: { savedPresets: mergeImportedExportPresets(current.export.savedPresets, presets, strategy) } }))
  })
  handle('resolveExportImage', async (context, input) => {
    const value = object(input)
    const document = context.documents.get(string(value.id, '文档 ID', 100))
    const source = string(value.source, '图片地址', 4096)
    if (!markdownImageSources(document.currentContent).some(item => normalizedImageSource(item) === normalizedImageSource(source))) throw new DesktopError('PERMISSION_DENIED', '只能导出当前文档实际引用的图片。')
    const image = await serialized('export-image-download', () => downloadRemoteImage(source))
    const mime = IMAGE_MIME[path.extname(image.name).toLowerCase()]
    return `data:${mime};base64,${Buffer.from(image.bytes).toString('base64')}`
  })
  handle('fileAction', (context, input) => {
    const value = object(input)
    if (typeof value.action !== 'string' || !['create-file', 'create-folder', 'rename', 'trash', 'duplicate'].includes(value.action)) invalid('文件操作无效。')
    return runFileAction(context, { action: value.action as FileAction['action'], path: string(value.path, '路径'), name: value.name === undefined ? undefined : string(value.name, '名称', 200) })
  })
  handle('moveFile', async (context, input) => {
    if (!context.documents.workspace) throw new DesktopError('PERMISSION_DENIED', '请先打开工作区文件夹。')
    const value = object(input)
    const entry = await context.fileMoves.move(context.documents.workspace, string(value.path, '文件路径'), string(value.destinationDirectory, '目标目录'))
    send(context, { type: 'workspace-changed', path: context.documents.workspace })
    return entry
  })
  handle('undoFileOperation', async context => {
    if (!context.documents.workspace) throw new DesktopError('PERMISSION_DENIED', '请先打开工作区文件夹。')
    const entry = await context.fileMoves.undo(context.documents.workspace)
    send(context, { type: 'workspace-changed', path: context.documents.workspace })
    return entry
  })
  handle('uploadImages', (context, input) => uploadImages(validateUploadImages(input), context.documents, resources, context.window.webContents.id, store.preferences.image))
  handle('showContextMenu', (context, input) => contextMenus.show(context.window, validateContextMenu(input)))
  handle('learnSpelling', (context, input) => learnSpelling(context.window.webContents.session, input))
  handle('forgetSpelling', (context, input) => forgetSpelling(context.window.webContents.session, input))
  handle('listSpellingWords', context => listSpellingWords(context.window.webContents.session))
  handle('readClipboard', async () => {
    const text = await clipboard.readText()
    let html = ''
    const items = await clipboard.read()
    for (const item of items) {
      if (!item.types.includes('text/html')) continue
      const value = await item.getType('text/html')
      if (value instanceof Blob) {
        if (value.size > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '剪贴板 HTML 超过 16 MB。')
        html = await value.text()
        break
      }
    }
    if (Buffer.byteLength(text, 'utf8') + Buffer.byteLength(html, 'utf8') > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '剪贴板内容超过 16 MB。')
    const images: import('../shared/image-options').ImportedImage[] = []
    let size = 0
    for (const item of items) {
      const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type))
      if (!type) continue
      if (images.length >= 20) throw new DesktopError('UNSUPPORTED', '剪贴板图片超过 20 张。')
      const value = await item.getType(type)
      if (!(value instanceof Blob)) continue
      size += value.size
      if (size > 32 * 1024 * 1024) throw new DesktopError('UNSUPPORTED', '剪贴板图片超过 32 MB。')
      images.push({ name: `clipboard-${images.length + 1}.${type === 'image/jpeg' ? 'jpg' : type.slice(6)}`, bytes: new Uint8Array(await value.arrayBuffer()) })
    }
    return { text, html, images }
  })
  handle('readClipboardText', async () => {
    const text = await clipboard.readText()
    if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '剪贴板文本超过 16 MB。')
    return text
  })
  handle('writeClipboard', async (_context, input) => {
    const content = validateClipboard(input)
    await clipboard.write([new ClipboardItem({ 'text/plain': content.text, ...(content.html === undefined ? {} : { 'text/html': content.html }) })])
  })
  handle('imageOperation', (context, input) => operateImage(validateImageOperation(input), context.documents, resources, context.window.webContents.id, {
    destination: async (source, action) => {
      const parsed = path.parse(source)
      const response = await dialog.showSaveDialog(context.window, { title: action === 'move' ? '移动 / 重命名图片' : action === 'copy' ? '复制图片到' : '图片另存为',
        defaultPath: action === 'move' ? source : path.join(parsed.dir, `${parsed.name}-副本${parsed.ext}`),
        filters: [{ name: '原图片格式', extensions: [parsed.ext.slice(1)] }], properties: ['createDirectory'] })
      return response.canceled || !response.filePath ? null : response.filePath
    },
    confirm: async (source, action, destination) => {
      const response = await dialog.showMessageBox(context.window, { type: 'warning', title: action === 'delete' ? '删除原图片' : '移动原图片',
        message: action === 'delete' ? `将原图片“${path.basename(source)}”移到回收站，并删除当前图片引用？` : `移动原图片“${path.basename(source)}”，并更新当前图片引用？`,
        detail: `原文件：${source}${destination ? `\n目标：${destination}` : ''}\n\n这张图片可能被其他文章共用。移动或删除原文件会使其他文章中的引用失效。仅当前文章中的此处引用会更新。`,
        buttons: [action === 'delete' ? '删除原图片及引用' : '移动原图片', '取消'], defaultId: 1, cancelId: 1, noLink: true })
      return response.response === 0
    },
    trash: (source) => shell.trashItem(source),
  }))
  handle('saveResource', async (context, input) => {
    const request = validateResourceSave(input)
    context.documents.get(request.id)
    const bytes = resourceBytes(request)
    if (request.format !== 'svg' && nativeImage.createFromBuffer(bytes).isEmpty()) invalid('资源图片不能正确解码。')
    const response = await dialog.showSaveDialog(context.window, { title: '资源另存为', defaultPath: `资源.${request.format}`,
      filters: [{ name: request.format.toUpperCase(), extensions: request.format === 'jpeg' ? ['jpeg', 'jpg'] : [request.format] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'] })
    if (response.canceled || !response.filePath) return null
    context.documents.get(request.id)
    return writeResource(response.filePath, request.format, bytes)
  })
  handle('searchFolder', async (context, input) => {
    const value = object(input)
    const root = context.documents.workspace
    if (!root) throw new DesktopError('PERMISSION_DENIED', '请先打开文件夹。')
    const requested = await canonicalInside(string(value.root, '搜索目录'), root)
    const request: SearchRequest = { root: requested, query: string(value.query, '搜索关键字', 256), caseSensitive: value.caseSensitive === undefined ? false : boolean(value.caseSensitive, '区分大小写'), wholeWord: value.wholeWord === undefined ? false : boolean(value.wholeWord, '全词匹配'), regex: value.regex === undefined ? false : boolean(value.regex, '正则表达式') }
    return searchMarkdown(request)
  })
  const exportRequest = (input: unknown): ExportRequest => {
    const value = object(input)
    if (!EXPORT_FORMATS.includes(value.kind as ExportRequest['kind'])) invalid('导出类型无效。')
    if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)) invalid('导出版本无效。')
    if (value.preferencesVersion !== undefined && (!Number.isSafeInteger(value.preferencesVersion) || Number(value.preferencesVersion) < 0)) invalid('导出配置版本无效。')
    return { id: string(value.id, '文档 ID', 100), kind: value.kind as ExportRequest['kind'], html: value.html === undefined ? undefined : string(value.html, 'HTML 内容', 24 * 1024 * 1024),
      revision: value.revision as number | undefined, preferencesVersion: value.preferencesVersion as number | undefined, reusePrevious: value.reusePrevious === undefined ? false : boolean(value.reusePrevious, '复用导出'), overwritePrevious: value.overwritePrevious === undefined ? false : boolean(value.overwritePrevious, '覆盖导出') }
  }
  const preparedExportRequest = (input: unknown): ExportRequest => {
    const request = exportRequest(input)
    if (request.preferencesVersion !== undefined && request.preferencesVersion !== preferencesVersion) throw new DesktopError('CONFLICT', '生成内容期间导出配置已改变，请重新导出。')
    return request
  }
  handle('getExportPlan', (context, input) => { const request = exportRequest(input); context.documents.get(request.id); return { ...getExportPlan(context.window, request, store.preferences.export), preferencesVersion } })
  handle('importExportPresets', context => importExportPresets(context.window))
  handle('exportExportPresets', (context, input) => exportExportPresets(context.window, input, () => [...windows.values()].flatMap(window => window.documents.records().flatMap(record => record.path ? [record.path] : []))))
  handle('exportDocument', (context, input) => exportDocument(context.window, context.documents, preparedExportRequest(input), resources, store.preferences.export, () => [...windows.values()].flatMap(window => window.documents.records().flatMap(record => record.path ? [record.path] : []))))
  handle('printDocument', (context, input) => printDocument(context.window, context.documents, preparedExportRequest(input), resources, store.preferences.export))
  const chooseImageDirectory = async (context: WindowContext): Promise<string | null> => {
    const result = await dialog.showOpenDialog(context.window, { title: '选择图片保存目录', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  }
  handle('organizeImages', (context, input) => organizeImages(validateUploadImages(input), context.documents, resources, context.window.webContents.id, store.preferences.image, () => chooseImageDirectory(context)))
  handle('importImages', (context, input) => importImages(validateImageImport(input), context.documents, store.preferences.image, () => chooseImageDirectory(context)))
  handle('insertImage', async (context, input) => {
    const state = context.documents.get(string(input, '文档 ID', 100))
    const snapshot = { id: state.record.id, content: state.currentContent, revision: state.revision }
    const response = await dialog.showOpenDialog(context.window, { title: '插入图片', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: Object.keys(IMAGE_MIME).map(extension => extension.slice(1)) }] })
    if (response.canceled || !response.filePaths.length) return null
    const result = await importImageFiles(snapshot, response.filePaths, context.documents, store.preferences.image, () => chooseImageDirectory(context))
    return result?.markdown ?? null
  })
  handle('importDocument', async (context) => {
    const choice = await dialog.showOpenDialog(context.window, { title: '导入文档（需要 Pandoc）', properties: ['openFile'], filters: [{ name: '可转换的文档', extensions: Object.keys(PANDOC_IMPORT_FORMATS).map(extension => extension.slice(1)) }] })
    if (choice.canceled || !choice.filePaths[0]) return null
    const selected = choice.filePaths[0]
    const from = PANDOC_IMPORT_FORMATS[path.extname(selected).toLowerCase()]
    if (!from) invalid('不支持此导入格式。')
    const { bytes: input } = await readFileSnapshot(await canonicalPath(selected), MAX_DOCUMENT_BYTES)
    const bytes = await withEmbeddedImportMedia(from, input, filterPath => runPandoc(input, from, 'gfm', store.preferences.export.pandocPath, filterPath))
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new DesktopError('UNSUPPORTED', '转换后的 Markdown 超过 16 MB。')
    const record = await context.documents.createImported(bytes.toString('utf8'))
    return record
  })
  handle('setZoomFactor', (context, input) => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0.5 || input > 2) invalid('缩放比例无效。')
    context.window.webContents.setZoomFactor(input)
  })
  handle('resolveResource', (context, source, documentPath) => resources.resolve(string(source, '资源地址', MAX_DOCUMENT_BYTES), documentPath === null ? null : string(documentPath, '文档路径'), context.documents, context.window.webContents.id))
  handle('openExternal', async (_context, input) => {
    const value = string(input, '链接地址', 8192)
    let url: URL
    try { url = new URL(value) } catch { invalid('链接地址无效。') }
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new DesktopError('PERMISSION_DENIED', '只允许通过系统浏览器打开 HTTP、HTTPS 或邮件链接。')
    await shell.openExternal(url.href)
  })
  handle('revealFile', async (context, input) => shell.showItemInFolder(await context.documents.authorize(string(input, '文件路径'))))
  handle('setAlwaysOnTop', (context, input) => context.window.setAlwaysOnTop(boolean(input, '窗口置顶')))
  handle('newWindow', async (context, input) => {
    if (input === undefined) return createWindow()
    const authorized = await context.documents.authorize(string(input, '新窗口路径'))
    const stat = await fs.lstat(authorized)
    if (!stat.isDirectory() && (!stat.isFile() || !MARKDOWN_EXTENSIONS.has(path.extname(authorized).toLowerCase()))) throw new DesktopError('UNSUPPORTED', '新窗口只能打开已授权的文件夹、Markdown 或文本文件。')
    return createWindow(authorized)
  })
}

app.whenReady().then(async () => {
  store = new LocalStore(app.getPath('userData'))
  await store.load()
  applySpellingPreferences()
  resources.register(protocol)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  registerIpc()
  createMenus()
  const jumpListStatus = configureWindowsJumpList(app, process.platform, app.isPackaged, process.execPath)
  if (jumpListStatus !== 'ok' && jumpListStatus !== 'not-applicable') console.error('[app] Jump List unavailable:', jumpListStatus)
  const openPath = process.argv.slice(1).find((argument) => MARKDOWN_EXTENSIONS.has(path.extname(argument).toLowerCase()))
  const startup = store.preferences.startup
  const restoredPath = startup === 'last-file' ? store.recentFiles[0] : startup === 'last-folder' ? store.recentFolders[0] : startup === 'custom-folder' ? store.preferences.startupFolder : undefined
  await createWindow(process.argv.includes('--new-document') ? undefined : openPath || restoredPath || undefined)
  await systemOpenFiles.start()
  app.on('activate', () => { if (!windows.size) void createWindow().catch((error: unknown) => console.error('[app] Window creation failed', error instanceof Error ? error.message : 'unknown')) })
}).catch((error: unknown) => {
  console.error('[app] Startup failed', error instanceof Error ? error.message : 'unknown')
  app.quit()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
