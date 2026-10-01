import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWriteNew, canonicalPath, duplicateMarkdown } from './files'

let directory: string
beforeEach(async () => { directory = await canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-file-actions-'))) })
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

describe('New unique filesystem resources', () => {
  it('duplicates exact bytes under unique names without replacing existing copies', async () => {
    const source = path.join(directory, 'note.md')
    const bytes = Buffer.from('\ufeff# mixed\r\nbody\n', 'utf8')
    await fs.writeFile(source, bytes)
    const [first, second] = await Promise.all([duplicateMarkdown(source), duplicateMarkdown(source)])
    expect(new Set([first.name, second.name])).toEqual(new Set(['note - 副本.md', 'note - 副本 (2).md']))
    expect(await fs.readFile(first.path)).toEqual(bytes)
    expect(await fs.readFile(second.path)).toEqual(bytes)
    expect(await fs.readFile(source)).toEqual(bytes)
  })

  it('rejects folders and files outside the supported Markdown/text formats', async () => {
    await fs.writeFile(path.join(directory, 'program.js'), 'script')
    await expect(duplicateMarkdown(directory)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(duplicateMarkdown(path.join(directory, 'program.js'))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('publishes one complete file atomically and preserves existing destination on collisions', async () => {
    const destination = path.join(directory, 'image.png')
    const [one, two] = await Promise.allSettled([atomicWriteNew(destination, Buffer.from('first')), atomicWriteNew(destination, Buffer.from('second'))])
    expect([one, two].filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(['first', 'second']).toContain(await fs.readFile(destination, 'utf8'))
    const baseline = await fs.readFile(destination)
    await expect(atomicWriteNew(destination, Buffer.from('third'))).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(destination)).toEqual(baseline)
    expect(await fs.readdir(directory)).toEqual(['image.png'])
  })
})
