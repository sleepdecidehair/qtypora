import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_OPTIONS, exportPresetSettings, type SavedExportPreset } from './export-options'
import { createExportPresetFile, MAX_EXPORT_PRESET_FILE_BYTES, mergeImportedExportPresets, parseExportPresetFile, renameExportPreset, serializeExportPresetFile, validateExportPresetFile } from './export-preset-file'

const preset = (name: string, header = ''): SavedExportPreset => ({ name, format: 'pdf', settings: exportPresetSettings({ ...DEFAULT_EXPORT_OPTIONS, header }) })

describe('portable presentation-only preset files', () => {
  it('round-trips version 1 including Chinese text and UTF-8 BOM', () => {
    const presets = [preset('打印方案', '页眉')]
    const text = serializeExportPresetFile(presets)
    expect(parseExportPresetFile('\ufeff' + text)).toEqual({ kind: 'qtypora-export-presets', version: 1, presets })
    expect(text).not.toMatch(/pandocPath|executable|customPresets|template/)
  })
  it('rejects unsupported versions, missing fields, executable settings and custom formats', () => {
    const file = createExportPresetFile([preset('Print')])
    expect(() => validateExportPresetFile({ ...file, version: 0 })).toThrow('版本')
    expect(() => validateExportPresetFile({ ...file, version: 2 })).toThrow('版本')
    expect(() => validateExportPresetFile({ version: 1, presets: [] })).toThrow('字段')
    expect(() => validateExportPresetFile({ ...file, executable: '/tmp/tool' })).toThrow('字段')
    expect(() => createExportPresetFile([{ ...preset('A'), format: 'custom' }])).toThrow('格式')
    for (const settings of [{ ...preset('A').settings, pandocPath: '/tmp/pandoc' }, { pageSize: 'A4' }, { ...preset('A').settings, template: '/tmp/template' }]) {
      expect(() => createExportPresetFile([{ ...preset('A'), settings }])).toThrow('字段')
    }
    expect(() => parseExportPresetFile('{bad json')).toThrow('JSON')
  })
  it('bounds UTF-8 bytes and entry count and rejects duplicate names or invalid dimensions', () => {
    expect(() => parseExportPresetFile('中'.repeat(Math.ceil(MAX_EXPORT_PRESET_FILE_BYTES / 3)))).toThrow('256 KB')
    expect(() => createExportPresetFile(Array.from({ length: 21 }, (_, index) => preset(String(index))))).toThrow('20')
    expect(() => createExportPresetFile([preset(' A '), preset('A')])).toThrow('重复')
    expect(() => createExportPresetFile([{ ...preset('A'), settings: { ...preset('A').settings, pageWidthMm: 1 } }])).toThrow('尺寸')
  })
  it('previews merge semantics without changing current values and enforces the combined count', () => {
    const current = [preset('A', 'existing'), preset('B')], incoming = [preset('A', 'imported'), preset('C')]
    expect(mergeImportedExportPresets(current, incoming, 'keep')).toEqual([...current, preset('C')])
    expect(mergeImportedExportPresets(current, incoming, 'replace')).toEqual([incoming[0], current[1], incoming[1]])
    expect(current[0].settings.header).toBe('existing')
    expect(() => mergeImportedExportPresets(Array.from({ length: 20 }, (_, index) => preset(String(index))), [preset('extra')], 'keep')).toThrow('20')
  })
  it('renames only the selected preset and refuses overwriting another name', () => {
    const before = [preset('A', 'value'), preset('B')]
    expect(renameExportPreset(before, 'A', ' C ')).toEqual([preset('C', 'value'), before[1]])
    expect(() => renameExportPreset(before, 'A', 'B')).toThrow('已存在')
    expect(() => renameExportPreset(before, 'missing', 'C')).toThrow('不存在')
    expect(() => renameExportPreset(before, 'A', '')).toThrow('名称')
    expect(before[0].name).toBe('A')
  })
})
