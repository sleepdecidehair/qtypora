import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: {}, session: {} }))
import { DEFAULT_EXPORT_OPTIONS, exportExtension, exportPresetSettings, normalizeExportOptions } from '../shared/export-options'
import { pdfOptions, secureHtml } from './exports'

describe('export options and document isolation', () => {
  it('migrates old preferences and rejects invalid paper, numeric and text settings', () => {
    expect(normalizeExportOptions(undefined)).toEqual(DEFAULT_EXPORT_OPTIONS)
    for (const input of [{ pageSize: 'bogus' }, { marginMm: -1 }, { imageWidth: Infinity }, { landscape: 'yes' }, { header: 'a\0b' }]) expect(() => normalizeExportOptions(input)).toThrow()
    expect(exportExtension('docx')).toBe('docx')
    expect(exportExtension('html-plain')).toBe('html')
    expect(exportExtension('latex')).toBe('tex')
  })
  it('converts millimetres to inches and escapes untrusted header text', () => {
    const result = pdfOptions({ ...DEFAULT_EXPORT_OPTIONS, marginMm: 25.4, header: '<img src=x onerror=alert(1)>', landscape: true, pageSize: 'Letter' })
    for (const side of ['top', 'bottom', 'left', 'right'] as const) expect(result.margins?.[side]).toBeCloseTo(1)
    expect(result.headerTemplate).toContain('&lt;img')
    expect(result.headerTemplate).not.toContain('<img')
    expect(result.footerTemplate).toContain('pageNumber')
    expect(result.landscape).toBe(true)
    expect(result.pageSize).toBe('Letter')
  })
  it('keeps a restrictive policy in portable HTML and removes refresh redirects', () => {
    const output = secureHtml('<meta http-equiv="refresh" content="0;url=https://bad.example"><h1>Title</h1>')
    expect(output).toContain("script-src 'none'")
    expect(output).not.toContain('http-equiv="refresh"')
    expect(output).toContain('<h1>Title</h1>')
  })
  it('uses custom paper inches and separate margins, rejecting unusable page space', () => {
    const options = normalizeExportOptions({ pageSize: 'custom', pageWidthMm: 254, pageHeightMm: 381, separateMargins: true, marginTopMm: 25.4, marginBottomMm: 12.7, marginLeftMm: 0, marginRightMm: 38.1 })
    const pdf = pdfOptions(options)
    expect(pdf.pageSize).toEqual({ width: 10, height: 15 })
    for (const [side, expected] of Object.entries({ top: 1, bottom: 0.5, left: 0, right: 1.5 })) expect(pdf.margins?.[side as keyof NonNullable<typeof pdf.margins>]).toBeCloseTo(expected)
    expect(() => normalizeExportOptions({ pageSize: 'custom', pageWidthMm: 50, marginMm: 25 })).toThrow('页边距')
  })
  it('normalizes named presets without allowing executable settings or recursive payloads', () => {
    const preset = { name: ' Print ', format: 'pdf', settings: exportPresetSettings({ ...DEFAULT_EXPORT_OPTIONS, pageSize: 'Letter', header: 'Project' }) }
    const options = normalizeExportOptions({ savedPresets: [preset] })
    expect(options.savedPresets[0]).toMatchObject({ name: 'Print', format: 'pdf', settings: { pageSize: 'Letter', header: 'Project' } })
    expect(() => normalizeExportOptions({ savedPresets: [preset, preset] })).toThrow('重复')
    for (const settings of [{ savedPresets: [preset] }, { pandocPath: '/tmp/tool' }, { pageWidthMm: 1 }]) expect(() => normalizeExportOptions({ savedPresets: [{ ...preset, settings }] })).toThrow()
  })
})
