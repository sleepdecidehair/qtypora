import { normalizeCustomExport, type CustomExportPreset } from './custom-export'
export const EXPORT_FORMATS = ['html', 'html-plain', 'pdf', 'png', 'markdown', 'gfm', 'commonmark', 'plain', 'docx', 'odt', 'rtf', 'epub', 'latex', 'mediawiki', 'rst', 'textile', 'opml', 'revealjs', 'pptx', 'beamer', 'custom'] as const
export type ExportFormat = typeof EXPORT_FORMATS[number]
export const PAPER_SIZES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Letter', 'Legal', 'Tabloid', 'custom'] as const
const PRESET_FIELDS = ['pageSize', 'pageWidthMm', 'pageHeightMm', 'landscape', 'marginMm', 'separateMargins', 'marginTopMm', 'marginBottomMm', 'marginLeftMm', 'marginRightMm', 'header', 'footer', 'pageNumbers', 'outline', 'imageWidth', 'theme'] as const
export type ExportPresetSettings = Pick<ExportOptions, typeof PRESET_FIELDS[number]>
export interface SavedExportPreset { name: string; format: Exclude<ExportFormat, 'custom'>; settings: ExportPresetSettings }

export interface ExportOptions {
  pageSize: typeof PAPER_SIZES[number]
  pageWidthMm: number
  pageHeightMm: number
  landscape: boolean
  marginMm: number
  separateMargins: boolean
  marginTopMm: number
  marginBottomMm: number
  marginLeftMm: number
  marginRightMm: number
  header: string
  footer: string
  pageNumbers: boolean
  outline: boolean
  imageWidth: number
  theme: 'light' | 'dark' | 'current'
  pandocPath: string
  customPresets: CustomExportPreset[]
  customPreset: string
  savedPresets: SavedExportPreset[]
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  theme: 'light', pageSize: 'A4', pageWidthMm: 210, pageHeightMm: 297, landscape: false, marginMm: 15,
  separateMargins: false, marginTopMm: 15, marginBottomMm: 15, marginLeftMm: 15, marginRightMm: 15, header: '', footer: '',
  pageNumbers: true, outline: true, imageWidth: 1000, pandocPath: '', customPresets: [], customPreset: '', savedPresets: [],
}

export function exportPresetSettings(options: ExportOptions): ExportPresetSettings {
  return Object.fromEntries(PRESET_FIELDS.map(key => [key, options[key]])) as unknown as ExportPresetSettings
}

export function normalizeExportOptions(input: unknown): ExportOptions {
  const value = input === undefined ? {} : input
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('导出设置无效')
  const options = { ...DEFAULT_EXPORT_OPTIONS, ...value } as Record<string, unknown>
  if (!(PAPER_SIZES as readonly string[]).includes(typeof options.pageSize === 'string' ? options.pageSize : '')) throw new Error('纸张尺寸无效')
  if (!['light', 'dark', 'current'].includes(typeof options.theme === 'string' ? options.theme : '')) throw new Error('导出主题无效')
  for (const key of ['landscape', 'pageNumbers', 'outline', 'separateMargins']) if (typeof options[key] !== 'boolean') throw new Error('导出开关无效')
  for (const [key, min, max] of [['marginMm', 0, 50], ['marginTopMm', 0, 50], ['marginBottomMm', 0, 50], ['marginLeftMm', 0, 50], ['marginRightMm', 0, 50], ['pageWidthMm', 50, 1200], ['pageHeightMm', 50, 1200], ['imageWidth', 480, 2400]] as const) {
    const n = options[key]
    if (key === 'imageWidth' && !Number.isInteger(n)) throw new Error('长图宽度必须是整数')
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error('导出尺寸超出范围')
  }
  if (options.pageSize === 'custom') {
    const width = options.landscape ? options.pageHeightMm as number : options.pageWidthMm as number
    const height = options.landscape ? options.pageWidthMm as number : options.pageHeightMm as number
    const horizontal = options.separateMargins ? (options.marginLeftMm as number) + (options.marginRightMm as number) : (options.marginMm as number) * 2
    const vertical = options.separateMargins ? (options.marginTopMm as number) + (options.marginBottomMm as number) : (options.marginMm as number) * 2
    if (horizontal >= width || vertical >= height) throw new Error('页边距不能占满自定义纸张。')
  }
  for (const key of ['header', 'footer', 'pandocPath'] as const) {
    if (typeof options[key] !== 'string' || options[key].length > (key === 'pandocPath' ? 4096 : 500) || /[\0\r\n]/.test(options[key])) throw new Error('导出文本无效')
  }
  options.customPresets = normalizeCustomExport(options.customPresets)
  if (typeof options.customPreset !== 'string' || (options.customPreset && !(options.customPresets as CustomExportPreset[]).some(preset => preset.name === options.customPreset))) throw new Error('请选择有效的自定义导出配置。')
  if (!Array.isArray(options.savedPresets) || options.savedPresets.length > 20) throw new Error('最多保存 20 个导出预设。')
  const names = new Set<string>()
  options.savedPresets = options.savedPresets.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('导出预设无效。')
    const preset = item as Record<string, unknown>
    if (typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 80 || /[\u0000-\u001f]/.test(preset.name)) throw new Error('导出预设名称无效。')
    const name = preset.name.trim()
    if (names.has(name)) throw new Error('导出预设名称不能重复。')
    names.add(name)
    if (preset.format === 'custom' || !(EXPORT_FORMATS as readonly unknown[]).includes(preset.format)) throw new Error('导出预设格式无效。')
    if (!preset.settings || typeof preset.settings !== 'object' || Array.isArray(preset.settings) || Object.keys(preset.settings).some(key => !(PRESET_FIELDS as readonly string[]).includes(key))) throw new Error('导出预设设置无效。')
    // Presets store presentation settings only, never executable paths or nested presets.
    const settings = exportPresetSettings(normalizeExportOptions(preset.settings))
    return { name, format: preset.format, settings }
  })
  return Object.fromEntries(Object.keys(DEFAULT_EXPORT_OPTIONS).map(key => [key, options[key]])) as unknown as ExportOptions
}

export function exportExtension(format: ExportFormat): string {
  return ({ 'html-plain': 'html', markdown: 'md', gfm: 'md', commonmark: 'md', plain: 'txt', latex: 'tex', beamer: 'tex', mediawiki: 'wiki', revealjs: 'html' } as Partial<Record<ExportFormat, string>>)[format] ?? format
}
