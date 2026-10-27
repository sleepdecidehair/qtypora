import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: {}, session: {} }))
import type { BrowserWindow } from 'electron'
import { DEFAULT_EXPORT_OPTIONS, type ExportOptions } from '../shared/export-options'
import { ExportHistory } from './export-history'
import { getExportPlan } from './exports'

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-export-history-')) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })
const document = () => path.join(root, 'source.md')
const destination = () => path.join(root, 'result.pdf')

describe('persistent export history', () => {
  it('restores presentation options after restart without storing program paths or source text', async () => {
    const first = new ExportHistory(root)
    await first.load()
    const options: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, pageSize: 'Letter', header: 'Chapter', pandocPath: '/private/tool' }
    await first.record(document(), destination(), 'pdf', options)
    const text = await fs.readFile(path.join(root, 'export-history.json'), 'utf8')
    expect(text).not.toContain('/private/tool')
    expect(text).not.toContain('pandocPath')
    const restarted = new ExportHistory(root)
    await restarted.load()
    expect(restarted.get(document(), DEFAULT_EXPORT_OPTIONS)).toMatchObject({ kind: 'pdf', destination: destination(), options: { pageSize: 'Letter', header: 'Chapter', pandocPath: '' } })
    expect(restarted.get(path.join(root, 'other.md'), DEFAULT_EXPORT_OPTIONS)).toBeUndefined()
  })
  it('keeps distinct histories for canonical paths that differ only in case', async () => {
    const history = new ExportHistory(root); await history.load()
    const upper = path.join(root, 'Note.md'), lower = path.join(root, 'note.md')
    await history.record(upper, path.join(root, 'upper.pdf'), 'pdf', DEFAULT_EXPORT_OPTIONS)
    await history.record(lower, path.join(root, 'lower.html'), 'html', DEFAULT_EXPORT_OPTIONS)
    const restarted = new ExportHistory(root); await restarted.load()
    expect(restarted.get(upper, DEFAULT_EXPORT_OPTIONS)?.destination).toBe(path.join(root, 'upper.pdf'))
    expect(restarted.get(lower, DEFAULT_EXPORT_OPTIONS)?.destination).toBe(path.join(root, 'lower.html'))
  })
  it('restores custom export only through current user-approved program settings', async () => {
    const preset = { name: 'Tool', extension: 'txt', executable: '/private/old', args: ['{input}', '{output}'], input: 'markdown' as const, template: '' }
    const original = { ...DEFAULT_EXPORT_OPTIONS, customPresets: [preset], customPreset: preset.name }
    const first = new ExportHistory(root); await first.load()
    await first.record(document(), path.join(root, 'result.txt'), 'custom', original)
    const stored = await fs.readFile(path.join(root, 'export-history.json'), 'utf8')
    expect(stored).not.toContain('/private/old')
    const restarted = new ExportHistory(root); await restarted.load()
    const updated = { ...original, customPresets: [{ ...preset, executable: '/current/new' }] }
    expect(restarted.get(document(), updated)?.options.customPresets[0].executable).toBe('/current/new')
    expect(restarted.get(document(), DEFAULT_EXPORT_OPTIONS)?.options.customPresets).toEqual([])
    const request = { id: 'doc', kind: 'custom' as const, reusePrevious: true }
    expect(getExportPlan({} as BrowserWindow, request, updated, document(), restarted).options.customPresets[0].executable).toBe('/current/new')
    expect(() => getExportPlan({} as BrowserWindow, request, DEFAULT_EXPORT_OPTIONS, document(), restarted)).toThrow('自定义导出配置')
  })
  it('keeps externally modified and invalid history files rather than overwriting them', async () => {
    const history = new ExportHistory(root); await history.load()
    await history.record(document(), destination(), 'pdf', DEFAULT_EXPORT_OPTIONS)
    const file = path.join(root, 'export-history.json')
    await fs.writeFile(file, 'external update')
    await expect(history.record(document(), destination(), 'html', DEFAULT_EXPORT_OPTIONS)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(file, 'utf8')).toBe('external update')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const restarted = new ExportHistory(root); await restarted.load()
    expect(restarted.get(document(), DEFAULT_EXPORT_OPTIONS)).toBeUndefined()
    await expect(restarted.record(document(), destination(), 'pdf', DEFAULT_EXPORT_OPTIONS)).rejects.toMatchObject({ code: 'IO_ERROR' })
    expect(await fs.readFile(file, 'utf8')).toBe('external update')
  })
  it('keeps at most twenty distinct documents and serializes overlapping writes', async () => {
    const history = new ExportHistory(root); await history.load()
    await Promise.all(Array.from({ length: 22 }, (_, index) => history.record(path.join(root, `note-${index}.md`), destination(), 'pdf', DEFAULT_EXPORT_OPTIONS)))
    const saved = JSON.parse(await fs.readFile(path.join(root, 'export-history.json'), 'utf8'))
    expect(saved.items).toHaveLength(20)
    expect(history.revision).toBe(22)
    expect(history.get(path.join(root, 'note-0.md'), DEFAULT_EXPORT_OPTIONS)).toBeUndefined()
    expect(history.get(path.join(root, 'note-21.md'), DEFAULT_EXPORT_OPTIONS)).toBeDefined()
  })
})
