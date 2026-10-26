import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() } }))
import { dialog, type BrowserWindow } from 'electron'
import * as files from './files'
import { exportExportPresets, importExportPresets, readExportPresetFile, writeExportPresetFile } from './export-preset-files'
import { DEFAULT_EXPORT_OPTIONS, exportPresetSettings } from '../shared/export-options'
import { MAX_EXPORT_PRESET_FILE_BYTES, serializeExportPresetFile } from '../shared/export-preset-file'

let directory: string
const presets = [{ name: 'Print', format: 'pdf' as const, settings: exportPresetSettings(DEFAULT_EXPORT_OPTIONS) }]
const window = {} as BrowserWindow
beforeEach(async () => { directory = await files.canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-preset-files-'))) })
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllMocks(); await fs.rm(directory, { recursive: true, force: true }) })

describe('native preset file operations', () => {
  it('writes atomically and reads a bounded normalized file without exposing its directory', async () => {
    const filename = path.join(directory, 'presets.json')
    expect(await writeExportPresetFile(filename, presets, () => [])).toBe(filename)
    expect((await readExportPresetFile(filename)).presets).toEqual(presets)
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [filename] })
    expect(await importExportPresets(window)).toEqual({ fileName: 'presets.json', data: { kind: 'qtypora-export-presets', version: 1, presets } })
    expect((await fs.readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
  })
  it('distinguishes picker cancellation and rejects invalid payloads before showing a picker', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await importExportPresets(window)).toBeNull()
    expect(await exportExportPresets(window, presets, () => [])).toBeNull()
    await expect(exportExportPresets(window, [{ ...presets[0], executable: '/tmp/tool' }], () => [])).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
    expect(await fs.readdir(directory)).toEqual([])
  })
  it('rejects oversized, invalid UTF-8 and symlink inputs', async () => {
    const filename = path.join(directory, 'invalid.json')
    await fs.writeFile(filename, Buffer.from([0xff, 0xfe]))
    await expect(readExportPresetFile(filename)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await fs.truncate(filename, MAX_EXPORT_PRESET_FILE_BYTES + 1)
    await expect(readExportPresetFile(filename)).rejects.toThrow('256 KB')
    const link = path.join(directory, 'link.json')
    await fs.symlink(filename, link)
    await expect(readExportPresetFile(link)).rejects.toThrow('普通')
  })
  it('protects open source paths and aliases, including sources opened during the write', async () => {
    const filename = path.join(directory, 'source.json'), alias = path.join(directory, 'alias.json')
    await fs.writeFile(filename, 'valuable source')
    await fs.symlink(filename, alias)
    await expect(writeExportPresetFile(filename, presets, () => [alias])).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(writeExportPresetFile(alias, presets, () => [])).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    let checks = 0
    await expect(writeExportPresetFile(filename, presets, () => ++checks === 1 ? [] : [filename])).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(filename, 'utf8')).toBe('valuable source')
    expect((await fs.readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
  })
  it('does not replace an external change made while the atomic output was being prepared', async () => {
    const filename = path.join(directory, 'changed.json')
    await fs.writeFile(filename, serializeExportPresetFile(presets))
    const atomic = files.atomicWrite
    vi.spyOn(files, 'atomicWrite').mockImplementationOnce((destination, bytes, check) => atomic(destination, bytes, async () => {
      await fs.writeFile(filename, 'external change')
      await check?.()
    }))
    await expect(writeExportPresetFile(filename, presets, () => [])).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(filename, 'utf8')).toBe('external change')
    expect((await fs.readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
  })
})
