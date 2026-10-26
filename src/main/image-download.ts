import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import type { ImportedImage } from '../shared/image-options'
import { checkedImage } from './image-bytes'
import { DesktopError, invalid } from './errors'

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
const BLOCKED_V4 = new BlockList(), BLOCKED_V6 = new BlockList()
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) BLOCKED_V4.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['2001::', 32], ['2002::', 16]] as const) BLOCKED_V6.addSubnet(network, prefix, 'ipv6')
const EXTENSIONS: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico' }

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? !BLOCKED_V4.check(address, 'ipv4') : family === 6 && !BLOCKED_V6.check(address, 'ipv6')
}

export function remoteImageUrl(source: string): URL {
  let url: URL
  try { url = new URL(source) } catch { invalid('图片下载地址无效。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || source.length > 4096) invalid('图片下载只支持不含登录凭据的 HTTP(S) 地址。')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost') || (isIP(hostname) && !isPublicImageAddress(hostname))) throw new DesktopError('PERMISSION_DENIED', '图片下载不访问本机、私网或保留网络地址。')
  return url
}

export async function downloadedImage(source: string, type: string, bytes: Uint8Array): Promise<ImportedImage> {
  const extension = EXTENSIONS[type.split(';')[0].trim().toLowerCase()]
  if (!extension || bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new DesktopError('UNSUPPORTED', '远程文件不是支持的图片，或超过 10 MB。')
  let basename = path.basename(new URL(source).pathname)
  try { basename = decodeURIComponent(basename) } catch { /* Retain encoded filename. */ }
  const image = checkedImage({ name: `${path.parse(basename).name || 'downloaded-image'}${extension}`, bytes })
  if (extension !== '.svg') {
    const { nativeImage } = await import('electron')
    const decoded = nativeImage.createFromBuffer(Buffer.from(image.bytes))
    if (decoded.isEmpty()) throw new DesktopError('UNSUPPORTED', '远程图片无法解码。')
    const size = decoded.getSize()
    if (!size.width || !size.height || size.width > 16384 || size.height > 16384 || size.width * size.height > 40000000) throw new DesktopError('UNSUPPORTED', '远程图片尺寸过大。')
  }
  return image
}

interface DownloadResponse { location?: string; type?: string; bytes?: Uint8Array }
async function receiveImage(url: URL, deadline: number): Promise<DownloadResponse> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new DesktopError('IO_ERROR', '图片下载超过 20 秒。')
  let dnsTimer: ReturnType<typeof setTimeout> | undefined
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(new DesktopError('IO_ERROR', '图片域名解析超时。')), remaining) }),
  ]).finally(() => { if (dnsTimer) clearTimeout(dnsTimer) })
  if (!addresses.length || addresses.some(value => !isPublicImageAddress(value.address))) throw new DesktopError('PERMISSION_DENIED', '图片域名指向本机、私网或保留网络地址。')
  const address = addresses[0]
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      agent: false, family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: { Accept: 'image/*', 'Accept-Encoding': 'identity' },
    }, response => {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy()
        if (!response.headers.location) reject(new DesktopError('IO_ERROR', '图片服务器没有返回重定向地址。'))
        else resolve({ location: response.headers.location })
        return
      }
      if (status < 200 || status >= 300) { response.destroy(); reject(new DesktopError('IO_ERROR', `图片服务器返回 ${status}。`)); return }
      const type = response.headers['content-type'] ?? ''
      if (!EXTENSIONS[type.split(';')[0].trim().toLowerCase()] || Number(response.headers['content-length']) > MAX_DOWNLOAD_BYTES) { response.destroy(); reject(new DesktopError('UNSUPPORTED', '远程文件不是支持的图片，或超过 10 MB。')); return }
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) { response.destroy(); reject(new DesktopError('UNSUPPORTED', '远程图片超过 10 MB。')); return }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ type, bytes: Buffer.concat(chunks) }))
      response.on('error', () => reject(new DesktopError('IO_ERROR', '图片下载连接中断。')))
    })
    const timer = setTimeout(() => request.destroy(new Error('timeout')), Math.max(1, deadline - Date.now()))
    request.on('error', () => reject(new DesktopError('IO_ERROR', '图片下载失败或超过 20 秒，请检查网络。')))
    request.on('close', () => clearTimeout(timer))
  })
}

/** Called only from explicit organize/download/export actions, never normal image preview. */
export async function downloadRemoteImage(source: string): Promise<ImportedImage> {
  let url = remoteImageUrl(source)
  const deadline = Date.now() + 20000
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await receiveImage(url, deadline)
    if (response.location) {
      if (redirects === 5) throw new DesktopError('IO_ERROR', '图片重定向次数超过 5 次。')
      url = remoteImageUrl(new URL(response.location, url).href)
      continue
    }
    return downloadedImage(url.href, response.type!, response.bytes!)
  }
  throw new DesktopError('IO_ERROR', '图片下载失败。')
}
