import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite, canonicalInside, encodedDocument, readMarkdown, safeName, saveMarkdown, searchMarkdown } from './files'

let directory: string
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-files-')) })
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

describe('Markdown filesystem behavior', () => {
  it('round-trips UTF-8 BOM and CRLF without changing Chinese content', async () => {
    const target = path.join(directory, '中文.md')
    await fs.writeFile(target, encodedDocument('# 标题\n中文第一行\n', 'utf8-bom', 'CRLF'))
    const document = await readMarkdown(target)
    expect(document.encoding).toBe('utf8-bom')
    expect(document.lineEnding).toBe('CRLF')
    expect(document.content).toBe('# 标题\n中文第一行\n')
    await saveMarkdown(document, target, '# 标题\n中文第二行\n', true)
    const saved = await fs.readFile(target)
    expect(saved.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(saved.toString('utf8')).toBe('\ufeff# 标题\r\n中文第二行\r\n')
  })

  it('refuses to replace an externally modified file', async () => {
    const target = path.join(directory, 'conflict.md')
    await fs.writeFile(target, 'initial')
    const document = await readMarkdown(target)
    await fs.writeFile(target, 'external modification')
    await expect(saveMarkdown(document, target, 'editor modification', true)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(target, 'utf8')).toBe('external modification')
  })

  it('preserves all original bytes when saving an untouched file with mixed line endings', async () => {
    const target = path.join(directory, 'mixed.md')
    const original = Buffer.from('\ufeff# 标题\r\n\r\n中文内容😀\n末尾\r\n', 'utf8')
    await fs.writeFile(target, original)
    const document = await readMarkdown(target)
    const saved = await saveMarkdown(document, target, document.content, true)
    expect(await fs.readFile(target)).toEqual(original)
    expect(saved.version).toBe(document.version)
    expect(saved.content).toBe('# 标题\n\n中文内容😀\n末尾\n')
  })

  it('removes only the encoding BOM and retains a literal leading U+FEFF content character', async () => {
    const target = path.join(directory, 'bom-character.md')
    const original = Buffer.from('\ufeff\ufeff正文', 'utf8')
    await fs.writeFile(target, original)
    const document = await readMarkdown(target)
    expect(document.content).toBe('\ufeff正文')
    await saveMarkdown(document, target, document.content, true)
    expect(await fs.readFile(target)).toEqual(original)
  })

  it('serializes overlapping writes so a stale second document cannot overwrite the first', async () => {
    const target = path.join(directory, 'concurrent.md')
    await fs.writeFile(target, 'original')
    const document = await readMarkdown(target)
    const outcomes = await Promise.allSettled([
      saveMarkdown(document, target, 'first edit', true),
      saveMarkdown(document, target, 'stale second edit', true),
    ])
    expect(outcomes[0].status).toBe('fulfilled')
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } })
    expect(await fs.readFile(target, 'utf8')).toBe('first edit')
  })

  it('refuses invalid UTF-8 and binary files instead of rewriting them', async () => {
    const target = path.join(directory, 'encoding.md')
    await fs.writeFile(target, Buffer.from([0xff, 0xfe, 0x61]))
    await expect(readMarkdown(target)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await fs.writeFile(target, 'binary\0content')
    await expect(readMarkdown(target)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('reports a write failure and retains the existing document unchanged', async () => {
    const target = path.join(directory, 'original.md')
    await fs.writeFile(target, 'valuable content')
    await expect(atomicWrite(path.join(directory, 'missing', 'result.md'), Buffer.from('replacement'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(target, 'utf8')).toBe('valuable content')
    expect((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('aborts a prepared atomic replacement when the precommit conflict check fails', async () => {
    const target = path.join(directory, 'protected.md')
    await fs.writeFile(target, 'external original')
    await expect(atomicWrite(target, Buffer.from('would replace'), async () => { throw new Error('version changed') })).rejects.toThrow('version changed')
    expect(await fs.readFile(target, 'utf8')).toBe('external original')
    expect((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('blocks paths outside the authorized root and Windows reserved file names', async () => {
    await expect(canonicalInside(os.tmpdir(), directory)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    for (const name of ['../bad.md', 'CON.md', 'folder\\file.md', 'trailing.']) expect(() => safeName(name)).toThrow()
    expect(safeName('设计文档.md')).toBe('设计文档.md')
  })

  it('searches nested Markdown files with stable line numbers and literal text', async () => {
    const nested = path.join(directory, 'nested')
    await fs.mkdir(nested)
    await fs.writeFile(path.join(nested, '测试.md'), 'first\nLiteral [needle]\nLAST\n')
    const hits = await searchMarkdown({ root: directory, query: '[NEEDLE]' })
    expect(hits).toEqual([{ path: path.join(nested, '测试.md'), name: '测试.md', line: 2, text: 'Literal [needle]' }])
    expect(await searchMarkdown({ root: directory, query: '[NEEDLE]', caseSensitive: true })).toEqual([])
  })
})
