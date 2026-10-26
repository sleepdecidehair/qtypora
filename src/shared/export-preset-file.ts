import { DEFAULT_EXPORT_OPTIONS, exportPresetSettings, normalizeExportOptions, type SavedExportPreset } from './export-options'

export const MAX_EXPORT_PRESET_FILE_BYTES = 256 * 1024
export const MAX_EXPORT_PRESET_COUNT = 20
export interface ExportPresetFile { kind: 'qtypora-export-presets'; version: 1; presets: SavedExportPreset[] }
export interface ImportedExportPresets { fileName: string; data: ExportPresetFile }
export type PresetConflictStrategy = 'keep' | 'replace'

function strictObject(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象。`)
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(record, key))) throw new Error(`${label}字段不符合版本 1 格式。`)
  return record
}

export function validateExportPresetFile(input: unknown): ExportPresetFile {
  const file = strictObject(input, ['kind', 'version', 'presets'], '预设文件')
  if (file.kind !== 'qtypora-export-presets') throw new Error('这不是 QTypora 导出预设文件。')
  if (file.version !== 1) throw new Error('不支持此预设文件版本；目前仅支持版本 1。')
  if (!Array.isArray(file.presets) || file.presets.length > MAX_EXPORT_PRESET_COUNT) throw new Error('预设文件最多包含 20 项。')
  const settingFields = Object.keys(exportPresetSettings(DEFAULT_EXPORT_OPTIONS))
  for (const raw of file.presets) {
    const preset = strictObject(raw, ['name', 'format', 'settings'], '预设')
    strictObject(preset.settings, settingFields, '预设页面设置')
  }
  const presets = normalizeExportOptions({ savedPresets: file.presets }).savedPresets
  return { kind: 'qtypora-export-presets', version: 1, presets }
}

export function parseExportPresetFile(text: string): ExportPresetFile {
  if (text.length > MAX_EXPORT_PRESET_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_EXPORT_PRESET_FILE_BYTES) throw new Error('预设文件超过 256 KB。')
  let input: unknown
  try { input = JSON.parse(text.replace(/^\ufeff/, '')) }
  catch { throw new Error('预设文件不是有效的 JSON。') }
  return validateExportPresetFile(input)
}

export function createExportPresetFile(presets: unknown): ExportPresetFile {
  return validateExportPresetFile({ kind: 'qtypora-export-presets', version: 1, presets })
}

export function serializeExportPresetFile(presets: unknown): string {
  const text = JSON.stringify(createExportPresetFile(presets), null, 2) + '\n'
  if (new TextEncoder().encode(text).byteLength > MAX_EXPORT_PRESET_FILE_BYTES) throw new Error('预设文件超过 256 KB。')
  return text
}

export function mergeImportedExportPresets(current: SavedExportPreset[], incoming: SavedExportPreset[], strategy: PresetConflictStrategy): SavedExportPreset[] {
  if (strategy !== 'keep' && strategy !== 'replace') throw new Error('请选择有效的同名预设处理方式。')
  const existing = createExportPresetFile(current).presets
  const imported = createExportPresetFile(incoming).presets
  const merged = new Map(existing.map(item => [item.name, item]))
  for (const preset of imported) if (strategy === 'replace' || !merged.has(preset.name)) merged.set(preset.name, preset)
  return createExportPresetFile([...merged.values()]).presets
}

export function renameExportPreset(presets: SavedExportPreset[], before: string, after: string): SavedExportPreset[] {
  if (!presets.some(preset => preset.name === before)) throw new Error('所选预设已不存在，请重新选择。')
  const name = after.trim()
  if (name !== before && presets.some(preset => preset.name === name)) throw new Error('此名称已存在，请使用其他名称。')
  return createExportPresetFile(presets.map(preset => preset.name === before ? { ...preset, name } : preset)).presets
}
