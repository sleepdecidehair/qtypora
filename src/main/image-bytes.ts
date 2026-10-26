import path from 'node:path'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import type { ImportedImage } from '../shared/image-options'
import { DesktopError, invalid } from './errors'
import { IMAGE_MIME, MAX_DOCUMENT_BYTES, safeName } from './files'
import { resourceBytes } from './resource-save'

export async function readImageFile(filename: string): Promise<Buffer> {
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const original = await handle.stat()
    if (!original.isFile() || original.size > MAX_DOCUMENT_BYTES) invalid('图片必须是小于 16 MB 的普通文件。')
    const bytes = Buffer.alloc(original.size + 1)
    let read = 0
    while (read < bytes.length) {
      const chunk = await handle.read(bytes, read, bytes.length - read, read)
      if (!chunk.bytesRead) break
      read += chunk.bytesRead
    }
    const current = await handle.stat()
    if (read !== original.size || current.size !== original.size || current.mtimeMs !== original.mtimeMs || current.ctimeMs !== original.ctimeMs) throw new DesktopError('CONFLICT', '读取期间图片已变化，请重试。')
    return bytes.subarray(0, read)
  } finally { await handle.close() }
}

function bitmapSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 40000000) invalid('图片尺寸无效或超过像素预算。')
}

export function checkedImage(input: ImportedImage): ImportedImage {
  const extension = path.extname(input.name).toLowerCase()
  if (!IMAGE_MIME[extension] || !(input.bytes instanceof Uint8Array) || !input.bytes.byteLength || input.bytes.byteLength > MAX_DOCUMENT_BYTES) invalid('图片格式不支持，或图片超过 16 MB。')
  let bytes: Buffer = Buffer.from(input.bytes)
  if (extension === '.svg') bytes = resourceBytes({ id: 'image-import', format: 'svg', data: bytes.toString('utf8') })
  else if (extension === '.png' || extension === '.jpg' || extension === '.jpeg') {
    const format = extension === '.png' ? 'png' : 'jpeg'
    bytes = resourceBytes({ id: 'image-import', format, data: `data:image/${format};base64,${bytes.toString('base64')}` })
  } else {
    const valid = extension === '.gif' ? bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
      : extension === '.webp' ? bytes.length >= 20 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      : extension === '.bmp' ? bytes.length >= 26 && bytes.subarray(0, 2).toString('ascii') === 'BM'
      : bytes.length >= 22 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1 && bytes.readUInt16LE(4) > 0
    if (!valid) invalid('图片内容与扩展名不匹配。')
    if (extension === '.gif') bitmapSize(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
    if (extension === '.bmp' && bytes.length >= 26) {
      if (bytes.readUInt32LE(14) === 12) bitmapSize(bytes.readUInt16LE(18), bytes.readUInt16LE(20))
      else bitmapSize(bytes.readInt32LE(18), Math.abs(bytes.readInt32LE(22)))
    }
    if (extension === '.webp') {
      const kind = bytes.toString('ascii', 12, 16)
      if (kind === 'VP8X' && bytes.length >= 30) bitmapSize(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3))
      else if (kind === 'VP8 ' && bytes.length >= 30) bitmapSize(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff)
      else if (kind === 'VP8L' && bytes.length >= 25) {
        const bits = bytes.readUInt32LE(21)
        bitmapSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
      } else invalid('WebP 文件结构无效。')
    }
  }
  const filename = path.basename(input.name).replace(/[()[\]\\/<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '')
  return { name: safeName(filename), bytes }
}
