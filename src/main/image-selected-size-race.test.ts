import { expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import * as fs from 'node:fs/promises'

const victims = new Set<string>()
let replacement = Buffer.alloc(0)
vi.mock('node:fs/promises', async load => {
  const actual = await load<typeof import('node:fs/promises')>()
  return { ...actual, lstat: async (filename: string) => {
    const result = await actual.lstat(filename)
    if (victims.delete(filename)) await actual.writeFile(filename, replacement)
    return result
  } }
})
import { readSelectedImageFiles } from './image-import'

it('拒绝大小检查后变大而导致实际读取总量超过 32 MiB 的图片', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-selected-size-race-'))
  try {
    replacement = Buffer.alloc(12 * 1024 * 1024)
    replacement.write('BM')
    replacement.writeUInt32LE(40, 14)
    replacement.writeInt32LE(1, 18)
    replacement.writeInt32LE(1, 22)
    const files = [0, 1, 2].map(index => path.join(root, `${index}.bmp`))
    for (const filename of files) {
      await fs.writeFile(filename, replacement.subarray(0, 26))
      victims.add(filename)
    }
    await expect(readSelectedImageFiles(files)).rejects.toThrow('32 MB')
    expect(victims.size).toBe(0)
  } finally {
    victims.clear()
    replacement = Buffer.alloc(0)
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('正常读取多张合法图片', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-selected-normal-'))
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    const files = ['one.png', 'two.png'].map(name => path.join(root, name))
    for (const filename of files) await fs.writeFile(filename, png)
    const images = await readSelectedImageFiles(files)
    expect(images.map(image => image.name)).toEqual(['one.png', 'two.png'])
    expect(images.map(image => Buffer.from(image.bytes))).toEqual([png, png])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
