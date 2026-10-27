import * as fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_EXPORT_OPTIONS, EXPORT_FORMATS, exportPresetSettings, normalizeExportOptions, type ExportFormat, type ExportOptions, type ExportPresetSettings } from '../shared/export-options'
import { atomicWrite, hashBytes, serialized } from './files'
import { readFileSnapshot } from './file-snapshot'
import { DesktopError } from './errors'

const MAX_HISTORY_BYTES = 256 * 1024
const MAX_HISTORY_ITEMS = 20
const SETTING_FIELDS = Object.keys(exportPresetSettings(DEFAULT_EXPORT_OPTIONS))
interface HistoryItem { source: string; destination: string; kind: ExportFormat; settings: ExportPresetSettings; customPreset: string }
export interface PreviousExport { kind: ExportFormat; destination: string; options: ExportOptions }

function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function pathValue(value: unknown): value is string { return typeof value === 'string' && value.length <= 4096 && path.isAbsolute(value) && !value.includes('\0') }
function parseHistory(input: unknown): HistoryItem[] {
  if (!isObject(input) || input.version !== 1 || Object.keys(input).some(key => key !== 'version' && key !== 'items') || !Array.isArray(input.items) || input.items.length > MAX_HISTORY_ITEMS) throw new Error('导出历史格式无效。')
  const seen = new Set<string>()
  return input.items.map((raw: unknown) => {
    if (!isObject(raw) || Object.keys(raw).some(key => !['source', 'destination', 'kind', 'settings', 'customPreset'].includes(key)) || !pathValue(raw.source) || !pathValue(raw.destination) || typeof raw.kind !== 'string' || !(EXPORT_FORMATS as readonly string[]).includes(raw.kind) || typeof raw.customPreset !== 'string' || raw.customPreset.length > 80 || /[\u0000-\u001f\u007f]/.test(raw.customPreset) || !isObject(raw.settings) || Object.keys(raw.settings).some(key => !SETTING_FIELDS.includes(key)) || SETTING_FIELDS.some(key => !Object.hasOwn(raw.settings!, key))) throw new Error('导出历史内容无效。')
    const source = path.resolve(raw.source)
    if (seen.has(source)) throw new Error('导出历史包含重复文档。')
    seen.add(source)
    if ((raw.kind === 'custom') !== Boolean(raw.customPreset)) throw new Error('导出历史的自定义配置无效。')
    return { source, destination: path.resolve(raw.destination), kind: raw.kind as ExportFormat, settings: exportPresetSettings(normalizeExportOptions(raw.settings)), customPreset: raw.customPreset }
  })
}

/** History contains presentation settings only, never programs, arguments or document text. */
export class ExportHistory {
  private items: HistoryItem[] = []
  private version: string | null = null
  private available = true
  private revisionValue = 0
  private readonly file: string
  constructor(directory: string) { this.file = path.join(directory, 'export-history.json') }
  get revision(): number { return this.revisionValue }
  noteChange(): void { this.revisionValue++ }

  private async read(): Promise<{ bytes: Buffer; version: string } | null> {
    try {
      const { bytes } = await readFileSnapshot(this.file, MAX_HISTORY_BYTES)
      return { bytes, version: hashBytes(bytes) }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }

  async load(): Promise<void> {
    try {
      const stored = await this.read()
      if (!stored) return
      this.items = parseHistory(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored.bytes)))
      this.version = stored.version
    } catch {
      this.available = false
      console.error('[export] Export history is invalid or unavailable; original file retained')
    }
  }

  get(source: string | null, current: ExportOptions): PreviousExport | undefined {
    if (!source || !this.available) return undefined
    const item = this.items.find(value => value.source === path.resolve(source))
    if (!item) return undefined
    // Executable and Pandoc settings always come from currently approved preferences.
    return { kind: item.kind, destination: item.destination, options: { ...current, ...item.settings, customPreset: item.customPreset } }
  }

  async record(source: string, destination: string, kind: ExportFormat, options: ExportOptions): Promise<void> {
    if (!this.available) throw new DesktopError('IO_ERROR', '导出历史不可用，原历史文件已保留。')
    const item: HistoryItem = { source, destination, kind, settings: exportPresetSettings(options), customPreset: kind === 'custom' ? options.customPreset : '' }
    await serialized('export-history:' + this.file.toLowerCase(), async () => {
      const items = parseHistory({ version: 1, items: [item, ...this.items.filter(previous => previous.source !== path.resolve(source))].slice(0, MAX_HISTORY_ITEMS) })
      const bytes = Buffer.from(JSON.stringify({ version: 1, items }, null, 2) + '\n')
      if (bytes.length > MAX_HISTORY_BYTES) throw new DesktopError('UNSUPPORTED', '导出历史超过大小限制。')
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      await atomicWrite(this.file, bytes, async () => {
        if ((await this.read())?.version !== (this.version ?? undefined)) throw new DesktopError('CONFLICT', '导出历史被其他程序修改，未覆盖。')
      })
      this.items = items
      this.version = hashBytes(bytes)
      this.revisionValue++
    })
  }
}
