import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import MarkdownIt from 'markdown-it'
import type { ImageOptions, UploadImagesRequest, UploadImagesResult } from '../shared/image-options'
import { normalizeImageOptions } from '../shared/image-options'
import { DocumentSession, validateSnapshot } from './documents'
import { DesktopError, invalid, object, string } from './errors'
import { canonicalPath, MAX_DOCUMENT_BYTES, serialized } from './files'
import { markdownImageSources } from './image-paths'
import type { ResourceRegistry } from './resources'
import { isSafeDataImage } from '../shared/data-image'

const parser = new MarkdownIt()
export const normalizedImageSource = (source: string) => parser.normalizeLink(parser.utils.unescapeAll(source))

export function validateUploadImages(input: unknown): UploadImagesRequest {
  const value = object(input)
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 20) invalid('每批可上传 1 至 20 张本地图片。')
  let sourceBytes = 0
  const sources = value.sources.map(source => {
    const parsed = string(source, '图片地址', typeof source === 'string' && source.startsWith('data:') ? 14 * 1024 * 1024 : 4096)
    sourceBytes += parsed.length
    if (sourceBytes > 32 * 1024 * 1024 || (parsed.startsWith('data:') && !isSafeDataImage(parsed))) invalid('内嵌图片无效或图片地址总大小超过 32 MB。')
    return parsed
  })
  if (new Set(sources).size !== sources.length) invalid('上传图片地址不能重复。')
  return { ...validateSnapshot(value), sources }
}

export function uploaderUrls(output: string, count: number): string[] {
  const urls = output.split(/\r?\n/).map(line => line.trim()).filter(line => /^https?:\/\/\S+$/i.test(line)).map(line => {
    let url
    try { url = new URL(line) } catch { invalid('上传器返回了无效图片地址。') }
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) invalid('上传器返回的地址不能包含登录凭据。')
    return url.href
  })
  if (urls.length !== count) throw new DesktopError('IO_ERROR', '上传器返回的图片地址数量与上传数量不一致，原文引用未改变。')
  return urls
}

export async function runImageUploader(paths: string[], rawOptions: ImageOptions): Promise<string[]> {
  const options = normalizeImageOptions(rawOptions)
  if (!options.uploaderExecutable) throw new DesktopError('INVALID_INPUT', '请先在图片设置中配置上传器可执行文件和参数。')
  if (!paths.length || paths.length > 20) invalid('每批可上传 1 至 20 张图片。')
  const executable = await canonicalPath(options.uploaderExecutable)
  if (!(await fs.stat(executable)).isFile()) invalid('上传器必须是可执行文件。')
  await fs.access(executable, constants.X_OK)
  const args = options.uploaderArgs.includes('{files}') ? options.uploaderArgs.flatMap(arg => arg === '{files}' ? paths : [arg]) : [...options.uploaderArgs, ...paths]
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', total = 0, finished = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const fail = (message: string) => {
      if (finished) return
      finished = true; clearTimeout(timer)
      child.kill()
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 1000)
      killTimer.unref()
      reject(new DesktopError('IO_ERROR', message))
    }
    const timer = setTimeout(() => fail('图片上传超过 60 秒，已停止上传器。原文引用未改变。'), 60000)
    child.stdout.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > 1024 * 1024) { fail('上传器输出超过 1 MB，已停止。'); return }
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => { total += chunk.length; if (total > 1024 * 1024) fail('上传器输出超过 1 MB，已停止。') })
    child.on('error', () => fail('无法启动图片上传器，请检查可执行路径和权限。'))
    child.on('close', code => {
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer)
      if (finished) return
      finished = true
      if (code !== 0) reject(new DesktopError('IO_ERROR', `图片上传器退出代码 ${String(code)}，原文引用未改变。`))
      else resolve(stdout)
    })
  })
  return uploaderUrls(output, paths.length)
}

export async function uploadImages(request: UploadImagesRequest, documents: DocumentSession, resources: ResourceRegistry, owner: number, options: ImageOptions): Promise<UploadImagesResult> {
  const checked = validateUploadImages(request)
  await documents.sync(checked)
  const originalPath = documents.get(checked.id).record.path
  const unchanged = () => {
    let document
    try { document = documents.get(checked.id) } catch { throw new DesktopError('CONFLICT', '文档已关闭，未更新图片引用。') }
    if (document.record.readOnly) throw new DesktopError('READ_ONLY', '只读文档不能上传并替换图片引用。')
    if (document.revision !== checked.revision || document.currentContent !== checked.content || document.record.path !== originalPath) throw new DesktopError('CONFLICT', '上传期间文档发生变化，未更新原文引用。')
  }
  unchanged()
  const actual = new Set(markdownImageSources(checked.content).map(normalizedImageSource))
  if (checked.sources.some(source => !actual.has(normalizedImageSource(source)))) throw new DesktopError('PERMISSION_DENIED', '只能上传当前文档实际引用的本地图片。')
  const paths: string[] = []
  let bytes = 0
  for (const source of checked.sources) {
    const filename = await resources.localPath(source, originalPath, documents, owner)
    bytes += (await fs.stat(filename)).size
    if (bytes > MAX_DOCUMENT_BYTES * 2) invalid('单次上传总大小不能超过 32 MB。')
    paths.push(filename)
  }
  return serialized(`image-upload:${checked.id}`, async () => {
    unchanged()
    const urls = await runImageUploader(paths, options)
    unchanged()
    return { replacements: checked.sources.map((source, index) => ({ source, url: urls[index] })) }
  })
}
