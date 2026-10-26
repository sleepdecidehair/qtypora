import * as fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DocumentRecord } from '../shared/contracts'
import type { DocumentSession } from './documents'
import { DesktopError, invalid, object, string } from './errors'
import { MARKDOWN_EXTENSIONS, safeName } from './files'

const EXTERNAL_DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.docx', '.odt', '.rtf', '.xlsx', '.ods', '.pptx', '.odp', '.epub',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.mp4', '.webm', '.mov', '.m4v',
])

export interface LinkedFileHooks {
  confirmCreate(filePath: string): Promise<boolean>
  openPath(filePath: string): Promise<string>
}

export interface LinkedFileResult {
  document: DocumentRecord | null
  fragment: string | null
}

function linkPath(target: string, base: string | null): { filePath: string; fragment: string | null } {
  const separator = target.indexOf('#')
  const location = separator < 0 ? target : target.slice(0, separator)
  const fragment = separator < 0 ? null : target.slice(separator + 1) || null
  if (!location || /[\x00-\x1f]/.test(location)) invalid('本地链接路径无效。')
  if (/^file:/i.test(location)) {
    try {
      const url = new URL(location)
      if (url.hostname && url.hostname !== 'localhost' || url.search) invalid('不支持此文件链接。')
      return { filePath: fileURLToPath(url), fragment }
    } catch { invalid('文件链接格式无效。') }
  }
  let decoded: string
  try { decoded = decodeURIComponent(location) } catch { invalid('链接路径编码无效。') }
  if (/[\x00-\x1f]/.test(decoded) || !path.isAbsolute(decoded) && /^[a-z][a-z0-9+.-]*:/i.test(decoded)) invalid('仅允许本地文件链接。')
  if (!path.isAbsolute(decoded) && !base) invalid('请先保存文档或打开文件夹，再使用相对文件链接。')
  return { filePath: path.resolve(base || '', decoded), fragment }
}

/** A document link grants no new filesystem access and never becomes a shell command. */
export async function openLinkedFile(input: unknown, documents: DocumentSession, hooks: LinkedFileHooks): Promise<LinkedFileResult | null> {
  const request = object(input)
  const id = string(request.id, '文档 ID', 100)
  const target = string(request.target, '链接地址', 8192)
  const sourcePath = documents.get(id).record.path
  const { filePath, fragment } = linkPath(target, sourcePath ? path.dirname(sourcePath) : documents.workspace)
  const extension = path.extname(filePath).toLowerCase()
  const markdown = MARKDOWN_EXTENSIONS.has(extension)
  if (!markdown && !EXTERNAL_DOCUMENT_EXTENSIONS.has(extension)) throw new DesktopError('UNSUPPORTED', '此类型不能从文档链接直接打开。请在文件管理器中处理。')

  let canonical: string
  try { canonical = await documents.authorize(filePath) }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') || !markdown || extension === '.txt') throw error
    canonical = await documents.authorize(filePath, true)
    safeName(path.basename(canonical))
    if (!await hooks.confirmCreate(canonical)) return null
    if (documents.get(id).record.path !== sourcePath) throw new DesktopError('CONFLICT', '原文档位置已改变，请重新点击链接。')
    if (await documents.authorize(filePath, true) !== canonical) throw new DesktopError('CONFLICT', '目标文件夹已改变，请重新点击链接。')
    const handle = await fs.open(canonical, 'wx', 0o600)
    await handle.close()
  }
  const stat = await fs.stat(canonical)
  if (!stat.isFile()) invalid('链接目标不是普通文件。')
  documents.get(id)
  if (markdown) {
    if (!MARKDOWN_EXTENSIONS.has(path.extname(canonical).toLowerCase())) throw new DesktopError('UNSUPPORTED', '链接实际目标不是 Markdown 文件。')
    return { document: await documents.open(canonical), fragment }
  }
  if (!EXTERNAL_DOCUMENT_EXTENSIONS.has(path.extname(canonical).toLowerCase())) throw new DesktopError('UNSUPPORTED', '链接实际目标类型不受支持。')
  const error = await hooks.openPath(await documents.authorize(canonical))
  if (error) throw new DesktopError('IO_ERROR', '系统未能打开此附件。请检查是否安装了相应应用。')
  return { document: null, fragment: null }
}
