import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSnapshot } from './file-snapshot'
import { MAX_DOCUMENT_BYTES } from './files'

let directory: string
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-file-snapshot-')) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }) })

async function fileHandlePrototype(filename: string): Promise<fs.FileHandle> {
  const handle = await fs.open(filename, 'r')
  const prototype = Object.getPrototypeOf(handle) as fs.FileHandle
  await handle.close()
  return prototype
}

describe('bounded stable file snapshots', () => {
  it('preserves exact bytes and accepts an empty file without an unbounded read', async () => {
    const file = path.join(directory, 'source.docx')
    const bytes = Buffer.from('\ufeffline\r\nline\n')
    await fs.writeFile(file, bytes)
    expect((await readFileSnapshot(file, MAX_DOCUMENT_BYTES)).bytes).toEqual(bytes)
    await fs.writeFile(file, '')
    expect((await readFileSnapshot(file, MAX_DOCUMENT_BYTES)).bytes.byteLength).toBe(0)
  })

  it('rejects oversized input and non-regular paths before reading contents', async () => {
    const file = path.join(directory, 'large.docx')
    await fs.writeFile(file, Buffer.alloc(MAX_DOCUMENT_BYTES + 1))
    const prototype = await fileHandlePrototype(file)
    const read = vi.spyOn(prototype, 'read')
    await expect(readFileSnapshot(file, MAX_DOCUMENT_BYTES)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(read).not.toHaveBeenCalled()
    await expect(readFileSnapshot(directory, MAX_DOCUMENT_BYTES)).rejects.toBeDefined()
  })

  it('detects concurrent growth while keeping the read buffer bounded by the initial size', async () => {
    const file = path.join(directory, 'growing.docx')
    await fs.writeFile(file, 'small')
    const prototype = await fileHandlePrototype(file)
    const originalRead = prototype.read
    let bufferSize = 0
    vi.spyOn(prototype, 'read').mockImplementationOnce(async function (this: fs.FileHandle, ...args) {
      const buffer: unknown = Reflect.get(args, 0)
      if (!Buffer.isBuffer(buffer)) throw new Error('The snapshot reader must provide a bounded buffer')
      bufferSize = buffer.byteLength
      await fs.appendFile(file, Buffer.alloc(MAX_DOCUMENT_BYTES + 1))
      return Reflect.apply(originalRead, this, args)
    })
    await expect(readFileSnapshot(file, MAX_DOCUMENT_BYTES)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(bufferSize).toBe(6)
    expect((await fs.stat(file)).size).toBe(MAX_DOCUMENT_BYTES + 6)
  })

  it.skipIf(process.platform === 'win32')('rejects a named pipe without waiting for a writer', async () => {
    const filename = path.join(directory, 'pipe.docx')
    execFileSync('mkfifo', [filename])
    await expect(readFileSnapshot(filename, MAX_DOCUMENT_BYTES)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('rejects path replacement even when the new file has the same size and contents', async () => {
    const file = path.join(directory, 'replaced.docx')
    await fs.writeFile(file, 'same bytes')
    const prototype = await fileHandlePrototype(file)
    const originalRead = prototype.read
    vi.spyOn(prototype, 'read').mockImplementationOnce(async function (this: fs.FileHandle, ...args) {
      await fs.rename(file, path.join(directory, 'old-inode'))
      await fs.writeFile(file, 'same bytes')
      return Reflect.apply(originalRead, this, args)
    })
    await expect(readFileSnapshot(file, MAX_DOCUMENT_BYTES)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(file, 'utf8')).toBe('same bytes')
    expect(await fs.readFile(path.join(directory, 'old-inode'), 'utf8')).toBe('same bytes')
  })
})
