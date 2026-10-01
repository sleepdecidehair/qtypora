import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow, dialog, session } from 'electron'
import type { ExportRequest } from '../shared/contracts'
import type { DocumentSession } from './documents'
import { DesktopError } from './errors'
import { atomicWrite, encodedDocument } from './files'
import { ResourceRegistry } from './resources'

const EXPORT_POLICY = "default-src 'none'; script-src 'none'; img-src data: qtypora-media:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"

function secureHtml(html: string): string {
  // The export document is also untrusted input at IPC. JavaScript is disabled in the
  // export BrowserWindow, and this policy remains in downloaded HTML opened elsewhere.
  const policy = `<meta http-equiv="Content-Security-Policy" content="${EXPORT_POLICY}">`
  const cleaned = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[\s\S]*?>/gi, '')
  return `<!doctype html><html><head><meta charset="utf-8">${policy}</head><body>${cleaned}</body></html>`
}

export async function exportDocument(window: BrowserWindow, documents: DocumentSession, request: ExportRequest, resources: ResourceRegistry): Promise<string | null> {
  const document = documents.get(request.id)
  const extension = request.kind === 'markdown' ? 'md' : request.kind
  const choice = await dialog.showSaveDialog(window, {
    title: `导出 ${extension.toUpperCase()}`, defaultPath: path.join(document.record.path ? path.dirname(document.record.path) : '', `${path.parse(document.record.name).name}.${extension}`),
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  })
  if (choice.canceled || !choice.filePath) return null
  if (path.extname(choice.filePath).toLowerCase() !== `.${extension}`) throw new DesktopError('INVALID_INPUT', `导出文件需要 .${extension} 扩展名。`)
  if (request.kind === 'markdown') {
    await atomicWrite(choice.filePath, encodedDocument(document.currentContent, document.record.encoding, document.record.lineEnding))
    return choice.filePath
  }
  if (!request.html || request.html.length > 24 * 1024 * 1024) throw new DesktopError('INVALID_INPUT', '导出内容为空或过大。')
  const html = secureHtml(request.html)
  if (request.kind === 'html') {
    // Inline only tokenized local pictures; exported HTML must not depend on a running app.
    const portable = await inlineImages(html, resources, window.webContents.id)
    await atomicWrite(choice.filePath, Buffer.from(portable, 'utf8'))
    return choice.filePath
  }
  const exportSession = session.fromPartition(`qtypora-export-${randomUUID()}`)
  resources.register(exportSession.protocol)
  exportSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  exportSession.setPermissionCheckHandler(() => false)
  exportSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('data:') && !details.url.startsWith('qtypora-media:') })
  })
  const exportWindow = new BrowserWindow({ show: false, webPreferences: {
    session: exportSession, nodeIntegration: false, contextIsolation: true, sandbox: true,
    javascript: false, webSecurity: true, backgroundThrottling: false,
  } })
  exportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  exportWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const bytes = await exportWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true })
    await atomicWrite(choice.filePath, bytes)
    return choice.filePath
  } finally {
    exportWindow.destroy()
    exportSession.protocol.unhandle('qtypora-media')
    exportSession.webRequest.onBeforeRequest(null)
    await exportSession.clearStorageData()
  }
}

async function inlineImages(html: string, resources: ResourceRegistry, owner: number): Promise<string> {
  const sources = [...new Set(html.match(/qtypora-media:\/\/resource\/[a-f0-9-]+/gi) ?? [])]
  let output = html
  for (const source of sources) output = output.replaceAll(source, await resources.toDataUrl(source, owner))
  return output
}
