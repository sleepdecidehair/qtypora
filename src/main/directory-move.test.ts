import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as childProcess from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>() }))
import { moveDirectoryExclusive } from './directory-move'

let root: string
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-native-directory-'))) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })

const supported = process.platform === 'darwin' || process.platform === 'win32'

describe('exclusive native directory moves', () => {
  it.skipIf(!supported)('preserves nested bytes and refuses an existing destination', async () => {
    const source = path.join(root, "含 空格 ' 字符"), destination = path.join(root, 'new folder')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'note.md'), '\ufeff# note\r\n')
    await fs.mkdir(destination)
    await fs.writeFile(path.join(destination, 'other.txt'), 'other content')
    const identity = await fs.lstat(source)
    await expect(moveDirectoryExclusive(source, destination, identity)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(path.join(source, 'note.md'), 'utf8')).toBe('\ufeff# note\r\n')
    expect(await fs.readFile(path.join(destination, 'other.txt'), 'utf8')).toBe('other content')
    await fs.rm(destination, { recursive: true })
    expect(await moveDirectoryExclusive(source, destination, identity)).toEqual({ dev: identity.dev, ino: identity.ino })
    expect(await fs.readFile(path.join(destination, 'note.md'), 'utf8')).toBe('\ufeff# note\r\n')
    await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(!supported)('refuses a destination created immediately before the native call', async () => {
    const source = path.join(root, 'source'), destination = path.join(root, 'target')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'source.md'), 'source')
    const original = childProcess.execFile
    vi.spyOn(childProcess, 'execFile').mockImplementationOnce((...args) => {
      fsSync.mkdirSync(destination)
      fsSync.writeFileSync(path.join(destination, 'concurrent.md'), 'other writer')
      return Reflect.apply(original, childProcess, args)
    })
    await expect(moveDirectoryExclusive(source, destination)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(path.join(source, 'source.md'), 'utf8')).toBe('source')
    expect(await fs.readFile(path.join(destination, 'concurrent.md'), 'utf8')).toBe('other writer')
  })

  it.skipIf(!supported)('safely returns an externally replaced source after the native move', async () => {
    const source = path.join(root, 'source'), originalPath = path.join(root, 'external-old'), destination = path.join(root, 'target')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'original.md'), 'original')
    const original = childProcess.execFile
    vi.spyOn(childProcess, 'execFile').mockImplementationOnce((...args) => {
      fsSync.renameSync(source, originalPath)
      fsSync.mkdirSync(source)
      fsSync.writeFileSync(path.join(source, 'replacement.md'), 'replacement')
      return Reflect.apply(original, childProcess, args)
    })
    await expect(moveDirectoryExclusive(source, destination)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('退回') })
    expect(await fs.readFile(path.join(source, 'replacement.md'), 'utf8')).toBe('replacement')
    expect(await fs.readFile(path.join(originalPath, 'original.md'), 'utf8')).toBe('original')
    await expect(fs.lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
