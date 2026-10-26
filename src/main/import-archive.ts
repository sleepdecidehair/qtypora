import { inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import { DesktopError } from './errors'

const inflate = promisify(inflateRaw)
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_ENTRY_BYTES = 32 * 1024 * 1024
const invalidArchive = (): never => { throw new DesktopError('UNSUPPORTED', '导入压缩包无效、已加密或超过展开限制（单项 32 MB，总共 128 MB，最多 2048 项）。') }

/** Inspect and boundedly inflate entries before Pandoc sees an untrusted document archive. */
export async function validateImportArchive(input: Uint8Array): Promise<void> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) invalidArchive()
  const count = bytes.readUInt16LE(end + 10)
  const size = bytes.readUInt32LE(end + 12)
  const start = bytes.readUInt32LE(end + 16)
  if (!count || count > 2048 || bytes.readUInt16LE(end + 8) !== count || start + size !== end) invalidArchive()
  let position = start
  let total = 0
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) invalidArchive()
    const flags = bytes.readUInt16LE(position + 8)
    const method = bytes.readUInt16LE(position + 10)
    const packed = bytes.readUInt32LE(position + 20)
    const unpacked = bytes.readUInt32LE(position + 24)
    const nameLength = bytes.readUInt16LE(position + 28)
    const entryLength = 46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32)
    const local = bytes.readUInt32LE(position + 42)
    total += unpacked
    if ((flags & 1) || ![0, 8].includes(method) || unpacked > MAX_ENTRY_BYTES || total > MAX_ARCHIVE_BYTES || position + entryLength > end || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) invalidArchive()
    const localFlags = bytes.readUInt16LE(local + 6)
    const localMethod = bytes.readUInt16LE(local + 8)
    const localNameLength = bytes.readUInt16LE(local + 26)
    const data = local + 30 + localNameLength + bytes.readUInt16LE(local + 28)
    if (localFlags !== flags || localMethod !== method || data + packed > start || localNameLength !== nameLength || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(bytes.subarray(position + 46, position + 46 + nameLength))) invalidArchive()
    const name = bytes.toString('utf8', position + 46, position + 46 + nameLength)
    if (!name || /^[\\/]|^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes('..') || /[\x00-\x1f]/.test(name)) invalidArchive()
    if (method === 0) { if (packed !== unpacked) invalidArchive() }
    else {
      try {
        const expanded = await inflate(bytes.subarray(data, data + packed), { maxOutputLength: Math.min(MAX_ENTRY_BYTES, unpacked) + 1 })
        if (expanded.length !== unpacked) invalidArchive()
      } catch { invalidArchive() }
    }
    position += entryLength
  }
  if (position !== end) invalidArchive()
}
