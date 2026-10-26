import * as fs from 'node:fs/promises'
import { constants, type Stats } from 'node:fs'
import { DesktopError } from './errors'

export interface FileIdentity { dev: number; ino: number }
const sameIdentity = (first: FileIdentity, second: FileIdentity): boolean => first.dev === second.dev && first.ino === second.ino

/** Read a stable regular file through one handle, with an allocation/read ceiling. */
export async function readFileSnapshot(filename: string, maxBytes: number, expected?: FileIdentity): Promise<{ bytes: Buffer; stat: Stats }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new DesktopError('INVALID_INPUT', '文件大小限制无效。')
  // Non-blocking open lets fstat reject FIFOs without waiting for an external writer.
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > maxBytes) throw new DesktopError('UNSUPPORTED', `只能读取不超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 的普通文件。`)
    if (expected && !sameIdentity(before, expected)) throw new DesktopError('CONFLICT', '文件已被替换，请重试。')
    const bytes = Buffer.alloc(before.size + 1)
    let read = 0
    while (read < bytes.length) {
      const chunk = await handle.read(bytes, read, bytes.length - read, read)
      if (!chunk.bytesRead) break
      read += chunk.bytesRead
    }
    const after = await handle.stat()
    const current = await fs.lstat(filename)
    if (read !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.isSymbolicLink() || !sameIdentity(before, current) || current.size !== before.size || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) throw new DesktopError('CONFLICT', '读取期间文件已变化，请重试。')
    return { bytes: bytes.subarray(0, read), stat: before }
  } finally { await handle.close() }
}
