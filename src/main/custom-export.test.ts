import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeCustomExport, type CustomExportPreset } from '../shared/custom-export'
import { runCustomExport } from './custom-export'
import { runPandoc } from './pandoc'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-export-test-')) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
const preset = (args: string[]): CustomExportPreset => ({ name: 'Test', extension: 'txt', executable: process.execPath, args, input: 'markdown', template: '' })

describe('explicit custom converters', () => {
  it('passes paths/content as data, returns actual output and cleans staging input', async () => {
    const script = path.join(root, 'convert.cjs')
    const observed = path.join(root, 'observed.txt')
    await fs.writeFile(script, "const fs=require('node:fs');fs.writeFileSync(process.argv[3],fs.readFileSync(process.argv[2]));fs.writeFileSync(process.argv[4],process.argv[2])")
    const input = '# $(not-a-shell-command) `content`\n中文\n'
    const result = await runCustomExport(preset([script, '{input}', '{output}', observed]), input, '')
    expect(result.toString()).toBe(input)
    await expect(fs.stat(await fs.readFile(observed, 'utf8'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects invalid commands, missing output and nonzero process results', async () => {
    expect(() => normalizeCustomExport([preset(['{input}'])])).toThrow()
    expect(() => normalizeCustomExport([{ ...preset(['{input}', '{output}']), executable: 'relative' }])).toThrow()
    await expect(runCustomExport(preset(['-e', 'process.exit(0)']), 'content', '')).rejects.toMatchObject({ code: 'IO_ERROR' })
    await expect(runCustomExport(preset(['-e', 'process.exit(2)']), 'content', '')).rejects.toMatchObject({ code: 'IO_ERROR' })
  })
  it('reports an unavailable Pandoc as a prerequisite rather than a successful export', async () => {
    await expect(runPandoc(Buffer.from('data'), 'html', 'docx', path.join(root, 'missing-pandoc'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
