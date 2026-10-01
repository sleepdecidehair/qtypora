import * as fs from 'node:fs/promises'
import path from 'node:path'
import { DOMParser, XMLSerializer, type Element, type Node } from '@xmldom/xmldom'
import type { ResourceSaveRequest } from '../shared/contracts'
import { DesktopError, invalid, object, string } from './errors'
import { atomicWrite, canonicalPath, hashBytes, MAX_DOCUMENT_BYTES, safeName, serialized } from './files'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'
const svgTags = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath', 'title', 'desc', 'style', 'clipPath', 'mask', 'marker', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feComposite', 'feFlood', 'feMerge', 'feMergeNode', 'feMorphology', 'feTurbulence', 'feDisplacementMap', 'feDropShadow'])
const MAX_PIXELS = 40_000_000

function pixels(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > MAX_PIXELS) invalid('资源尺寸无效或超过像素预算。')
}

function safeCss(css: string): void {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '')
  if (/[\\\x00-\x08\x0b\x0c\x0e-\x1f]/.test(cleaned) || /@|expression\s*\(|(?:https?|file|data|javascript)\s*:|image-set\s*\(/i.test(cleaned)) invalid('SVG 样式不能引用外部资源或执行脚本。')
  for (const match of cleaned.matchAll(/url\s*\(([^)]*)\)/gi)) {
    if (!/^\s*["']?#[A-Za-z0-9_.:-]+["']?\s*$/.test(match[1])) invalid('SVG 仅允许内部样式资源引用。')
  }
}

function checkedSvg(data: string): Buffer {
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(data)) invalid('SVG 不允许 DTD、实体声明或处理指令。')
  let document
  try { document = new DOMParser({ onError: () => { throw new Error('Invalid XML') } }).parseFromString(data, 'image/svg+xml') }
  catch { invalid('SVG XML 格式无效。') }
  const root = document.documentElement
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) invalid('资源必须是 SVG 文档。')
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (viewBox && viewBox.length !== 4) invalid('SVG viewBox 无效。')
  if (viewBox && (viewBox.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9) || viewBox[2] <= 0 || viewBox[3] <= 0)) invalid('SVG viewBox 无效。')
  const width = root.getAttribute('width')
  const height = root.getAttribute('height')
  if (width && height && /^\d+(?:\.\d+)?(?:px)?$/.test(width) && /^\d+(?:\.\d+)?(?:px)?$/.test(height)) pixels(Number.parseFloat(width), Number.parseFloat(height))
  let visited = 0
  function visit(node: Node, depth: number): void {
    if (++visited > 100000 || depth > 256) invalid('SVG 结构过于复杂。')
    if (node.nodeType === 1) {
      const element = node as Element
      if (element.namespaceURI !== SVG_NAMESPACE || !element.localName || !svgTags.has(element.localName)) invalid('SVG 包含不支持或可执行的元素。')
      for (let index = 0; index < element.attributes.length; index++) {
        const attribute = element.attributes.item(index)!
        if (attribute.namespaceURI === XMLNS_NAMESPACE) continue
        if (attribute.namespaceURI && attribute.namespaceURI !== XLINK_NAMESPACE && attribute.namespaceURI !== 'http://www.w3.org/XML/1998/namespace') invalid('SVG 属性命名空间无效。')
        const name = (attribute.localName ?? attribute.name).toLowerCase()
        if (name.startsWith('on') || name === 'base' || name === 'src') invalid('SVG 不允许事件、基地址或外部资源。')
        if (name === 'href' && !/^#[A-Za-z0-9_.:-]+$/.test(attribute.value)) invalid('SVG 仅允许内部链接。')
        if (['style', 'fill', 'stroke', 'filter', 'mask', 'clip-path', 'cursor', 'marker', 'marker-start', 'marker-mid', 'marker-end'].includes(name) || /url\s*\(/i.test(attribute.value)) safeCss(attribute.value)
      }
      if (element.localName === 'style') safeCss(element.textContent ?? '')
    } else if (![3, 4, 8, 9].includes(node.nodeType)) invalid('SVG 节点类型无效。')
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child, depth + 1)
  }
  visit(document, 0)
  return Buffer.from(new XMLSerializer().serializeToString(document), 'utf8')
}

function checkedBitmap(format: 'png' | 'jpeg', data: string): Buffer {
  const prefix = `data:image/${format};base64,`
  if (!data.startsWith(prefix)) invalid('图片数据与声明格式不一致。')
  const base64 = data.slice(prefix.length)
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) invalid('图片 Base64 数据无效。')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length > MAX_DOCUMENT_BYTES || bytes.toString('base64') !== base64) invalid('图片数据无效或超过 16 MB。')
  if (format === 'png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') invalid('PNG 文件结构无效。')
    pixels(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
  } else {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid('JPEG 文件结构无效。')
    let offset = 2
    let found = false
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) invalid('JPEG 标记无效。')
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) invalid('JPEG 标记截断。')
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) invalid('JPEG 数据截断。')
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) invalid('JPEG 尺寸无效。')
        pixels(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))
        found = true
        break
      }
      offset += length
    }
    if (!found) invalid('JPEG 缺少有效尺寸。')
  }
  return bytes
}

export function validateResourceSave(value: unknown): ResourceSaveRequest {
  const input = object(value)
  if (!['svg', 'png', 'jpeg'].includes(String(input.format))) invalid('资源保存格式无效。')
  return { id: string(input.id, '文档 ID', 100), format: input.format as ResourceSaveRequest['format'], data: string(input.data, '资源内容', 24 * 1024 * 1024) }
}

export function resourceBytes(request: ResourceSaveRequest): Buffer {
  if (Buffer.byteLength(request.data, 'utf8') > 24 * 1024 * 1024) invalid('资源内容超过大小限制。')
  const bytes = request.format === 'svg' ? checkedSvg(request.data) : checkedBitmap(request.format, request.data)
  if (bytes.length > MAX_DOCUMENT_BYTES) invalid('资源超过 16 MB。')
  return bytes
}

export async function writeResource(selected: string, format: ResourceSaveRequest['format'], bytes: Buffer): Promise<string> {
  const directory = await canonicalPath(path.dirname(selected))
  const destination = path.join(directory, safeName(path.basename(selected)))
  const extensions = format === 'jpeg' ? ['.jpeg', '.jpg'] : [`.${format}`]
  if (!extensions.includes(path.extname(destination).toLowerCase())) invalid('目标文件扩展名与资源格式不一致。')
  return serialized(`resource-save:${destination.toLowerCase()}`, async () => {
    let baseline: string | null = null
    try {
      const stat = await fs.lstat(destination)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCUMENT_BYTES) throw new DesktopError('PERMISSION_DENIED', '目标必须是普通资源文件。')
      baseline = hashBytes(await fs.readFile(destination))
    } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
    await atomicWrite(destination, bytes, async () => {
      try {
        const stat = await fs.lstat(destination)
        if (!stat.isFile() || stat.isSymbolicLink() || hashBytes(await fs.readFile(destination)) !== baseline) throw new DesktopError('CONFLICT', '目标资源在保存过程中发生变化，未执行覆盖。')
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' && baseline === null) return
        throw error
      }
    })
    return destination
  })
}
