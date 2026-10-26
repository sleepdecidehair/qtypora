import * as fs from 'node:fs/promises'
import { runCustomExport } from './custom-export'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow, dialog, session } from 'electron'
import type { ExportRequest } from '../shared/contracts'
import { DEFAULT_EXPORT_OPTIONS, exportExtension, type ExportFormat, type ExportOptions } from '../shared/export-options'
import type { DocumentSession } from './documents'
import { DesktopError } from './errors'
import { atomicWrite, encodedDocument, canonicalPath, serialized } from './files'
import { ResourceRegistry } from './resources'
import { PANDOC_EXPORT_FORMATS, PANDOC_SOURCE_FORMATS, runPandoc } from './pandoc'

const EXPORT_POLICY = "default-src 'none'; script-src 'none'; img-src data: qtypora-media:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"
const previousExports = new WeakMap<BrowserWindow, Map<string, { kind: ExportFormat; destination: string; options: ExportOptions }>>()

export function secureHtml(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${EXPORT_POLICY}">`
  const cleaned = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[\s\S]*?>/gi, '')
  return `<!doctype html><html><head><meta charset="utf-8">${policy}</head><body>${cleaned}</body></html>`
}

function escaped(text: string): string { return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!) }

export function pdfOptions(options: ExportOptions): Electron.PrintToPDFOptions {
  const margins = pageMargins(options, 1 / 25.4)
  const template = (text: string, pageNumbers = false) => `<div style="font-size:9px;width:100%;text-align:center;color:#555">${escaped(text)}${pageNumbers ? ' <span class="pageNumber"></span> / <span class="totalPages"></span>' : ''}</div>`
  return { printBackground: true, pageSize: options.pageSize === 'custom' ? { width: options.pageWidthMm / 25.4, height: options.pageHeightMm / 25.4 } : options.pageSize, landscape: options.landscape, preferCSSPageSize: false,
    margins, generateDocumentOutline: options.outline,
    displayHeaderFooter: !!options.header || !!options.footer || options.pageNumbers,
    headerTemplate: template(options.header), footerTemplate: template(options.footer, options.pageNumbers) }
}

function pageMargins(options: ExportOptions, scale: number): { top: number; bottom: number; left: number; right: number } {
  return options.separateMargins ? { top: options.marginTopMm * scale, bottom: options.marginBottomMm * scale, left: options.marginLeftMm * scale, right: options.marginRightMm * scale }
    : { top: options.marginMm * scale, bottom: options.marginMm * scale, left: options.marginMm * scale, right: options.marginMm * scale }
}

async function withExportWindow<T>(html: string, resources: ResourceRegistry, width: number, operation: (window: BrowserWindow) => Promise<T>): Promise<T> {
  const exportSession = session.fromPartition(`qtypora-export-${randomUUID()}`)
  resources.register(exportSession.protocol)
  exportSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  exportSession.setPermissionCheckHandler(() => false)
  exportSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') && !details.url.startsWith('qtypora-media:') }))
  const exportWindow = new BrowserWindow({ show: false, width, height: 1000, useContentSize: true, webPreferences: {
    session: exportSession, nodeIntegration: false, contextIsolation: true, sandbox: true,
    javascript: false, webSecurity: true, backgroundThrottling: false,
  } })
  exportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  exportWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(secureHtml(html))}`)
    return await operation(exportWindow)
  } finally {
    exportWindow.destroy()
    exportSession.protocol.unhandle('qtypora-media')
    exportSession.webRequest.onBeforeRequest(null)
    await exportSession.clearStorageData()
  }
}

export function getExportPlan(window: BrowserWindow, request: ExportRequest, options: ExportOptions): { kind: ExportFormat; requiresHtml: boolean; options: ExportOptions } {
  const previous = previousExports.get(window)?.get(request.id)
  if (request.reusePrevious && !previous) throw new DesktopError('NOT_FOUND', '此文档尚无成功的导出记录。')
  const kind = request.reusePrevious && previous ? previous.kind : request.kind
  const selected = request.reusePrevious && previous ? previous.options : options
  const custom = selected.customPresets.find(preset => preset.name === selected.customPreset)
  if (kind === 'custom' && !custom) throw new DesktopError('INVALID_INPUT', '请先在导出设置中添加并选择自定义导出配置。')
  return { kind, requiresHtml: kind !== 'markdown' && !PANDOC_SOURCE_FORMATS.has(kind) && !(kind === 'custom' && custom?.input === 'markdown'), options: selected }
}

export async function exportDocument(window: BrowserWindow, documents: DocumentSession, request: ExportRequest, resources: ResourceRegistry, options = DEFAULT_EXPORT_OPTIONS, sourcePaths: () => string[] = () => documents.records().flatMap(item => item.path ? [item.path] : [])): Promise<string | null> {
  const state = documents.get(request.id)
  if (request.revision !== undefined && request.revision !== state.revision) throw new DesktopError('CONFLICT', '文档已更新，请重新导出。')
  const record = { ...state.record }
  const content = state.currentContent
  const previous = previousExports.get(window)?.get(request.id)
  if (request.reusePrevious && !previous) throw new DesktopError('NOT_FOUND', '此文档尚无成功的导出记录。')
  const kind = request.reusePrevious && previous ? previous.kind : request.kind
  const selectedOptions = request.reusePrevious && previous ? previous.options : options
  const customPreset = selectedOptions.customPresets.find(preset => preset.name === selectedOptions.customPreset)
  if (kind === 'custom' && !customPreset) throw new DesktopError('INVALID_INPUT', '请先在导出设置中添加并选择自定义导出配置。')
  const extension = kind === 'custom' ? customPreset!.extension : exportExtension(kind)
  let destination: string
  if (request.overwritePrevious && request.reusePrevious && previous) {
    const answer = await dialog.showMessageBox(window, { type: 'question', message: `覆盖上次导出文件“${path.basename(previous.destination)}”？`, detail: previous.destination, buttons: ['覆盖', '取消'], defaultId: 1, cancelId: 1 })
    if (answer.response !== 0) return null
    destination = previous.destination
  } else {
    const choice = await dialog.showSaveDialog(window, {
      title: `导出 ${extension.toUpperCase()}`, defaultPath: previous && request.reusePrevious ? previous.destination : path.join(record.path ? path.dirname(record.path) : '', `${path.parse(record.name).name}.${extension}`),
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }], properties: ['showOverwriteConfirmation', 'createDirectory'],
    })
    if (choice.canceled || !choice.filePath) return null
    destination = choice.filePath
  }
  if (path.extname(destination).toLowerCase() !== `.${extension}`) throw new DesktopError('INVALID_INPUT', `导出文件需要 .${extension} 扩展名。`)
  const canonicalDestination = path.join(await canonicalPath(path.dirname(path.resolve(destination))), path.basename(destination))
  const checkSource = async () => {
    let target = canonicalDestination
    try { target = await canonicalPath(canonicalDestination) } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
    if (sourcePaths().some(source => path.resolve(source).toLowerCase() === target.toLowerCase())) throw new DesktopError('CONFLICT', '导出目标不能覆盖任何已打开的源文档，请另选文件名。')
  }
  await checkSource()
  const outputVersion = async (): Promise<string | null> => {
    try { const stat = await fs.stat(canonicalDestination, { bigint: true }); return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null; throw error }
  }
  const expectedVersion = await outputVersion()
  let bytes: Buffer
  if (kind === 'markdown') bytes = encodedDocument(content, record.encoding, record.lineEnding)
  else if (PANDOC_SOURCE_FORMATS.has(kind)) bytes = await runPandoc(Buffer.from(content, 'utf8'), 'markdown', kind, selectedOptions.pandocPath)
  else if (kind === 'custom' && customPreset?.input === 'markdown') bytes = await runCustomExport(customPreset, content, '')
  else {
    if (!request.html || request.html.length > 24 * 1024 * 1024) throw new DesktopError('INVALID_INPUT', '导出内容为空或过大。')
    let html = await inlineImages(request.html, resources, window.webContents.id)
    if (kind === 'html-plain') html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    if (kind === 'html' || kind === 'html-plain') bytes = Buffer.from(secureHtml(html), 'utf8')
    else if (kind === 'custom') bytes = await runCustomExport(customPreset!, content, html)
    else if (PANDOC_EXPORT_FORMATS.has(kind)) bytes = await runPandoc(Buffer.from(html, 'utf8'), 'html', kind, selectedOptions.pandocPath)
    else bytes = await withExportWindow(html, resources, selectedOptions.imageWidth, async exportWindow => {
      if (kind === 'pdf') return exportWindow.webContents.printToPDF(pdfOptions(selectedOptions))
      // Measure and capture through Chromium's layout API; document JavaScript stays disabled.
      const debuggerSession = exportWindow.webContents.debugger
      debuggerSession.attach('1.3')
      try {
        const metrics = await debuggerSession.sendCommand('Page.getLayoutMetrics') as { cssContentSize: { height: number } }
        const height = Math.ceil(metrics.cssContentSize.height)
        if (!Number.isFinite(height) || height < 1 || height > 16000) throw new DesktopError('UNSUPPORTED', '长图高度超过 16000 像素，请改用 PDF 导出或拆分文档。')
        await debuggerSession.sendCommand('Emulation.setDeviceMetricsOverride', { width: selectedOptions.imageWidth, height, deviceScaleFactor: 1, mobile: false })
        const capture = await debuggerSession.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: selectedOptions.imageWidth, height, scale: 1 } }) as { data: string }
        if (!capture.data) throw new DesktopError('IO_ERROR', '长图生成失败。')
        return Buffer.from(capture.data, 'base64')
      } finally { if (debuggerSession.isAttached()) debuggerSession.detach() }
    })
  }
  if (!bytes.length) throw new DesktopError('IO_ERROR', '导出结果为空。')
  // Share the destination queue with saveMarkdown, including a Save As whose new
  // path has not yet been published to its owning document session.
  await serialized(canonicalDestination.toLowerCase(), () => atomicWrite(canonicalDestination, bytes, async () => {
    await checkSource()
    if (await outputVersion() !== expectedVersion) throw new DesktopError('CONFLICT', '导出期间目标文件发生改变，未覆盖外部修改。请重新导出。')
  }))
  let history = previousExports.get(window)
  if (!history) { history = new Map(); previousExports.set(window, history) }
  history.set(request.id, { kind, destination, options: structuredClone(selectedOptions) })
  return destination
}

export async function printDocument(window: BrowserWindow, documents: DocumentSession, request: ExportRequest, resources: ResourceRegistry, options: ExportOptions): Promise<boolean> {
  const state = documents.get(request.id)
  if (request.revision !== undefined && request.revision !== state.revision) throw new DesktopError('CONFLICT', '文档已更新，请重新打印。')
  if (!request.html || request.html.length > 24 * 1024 * 1024) throw new DesktopError('INVALID_INPUT', '打印内容为空或过大。')
  const html = await inlineImages(request.html, resources, window.webContents.id)
  return withExportWindow(html, resources, options.imageWidth, exportWindow => new Promise<boolean>((resolve, reject) => {
    exportWindow.webContents.print({ silent: false, printBackground: true, landscape: options.landscape,
      pageSize: options.pageSize === 'custom' ? { width: Math.round(options.pageWidthMm * 1000), height: Math.round(options.pageHeightMm * 1000) } : options.pageSize,
      margins: { marginType: 'custom', ...pageMargins(options, 96 / 25.4) } }, (success, reason) => {
      if (success) resolve(true)
      else if (/cancel/i.test(reason)) resolve(false)
      else reject(new DesktopError('IO_ERROR', `打印失败：${reason}`))
    })
  }))
}

async function inlineImages(html: string, resources: ResourceRegistry, owner: number): Promise<string> {
  const { inlineResourceImages } = await import('../shared/export-budget')
  return inlineResourceImages(html, source => resources.toDataUrl(source, owner))
}
