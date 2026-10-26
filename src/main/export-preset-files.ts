import * as fs from 'node:fs/promises'
import path from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { MAX_EXPORT_PRESET_FILE_BYTES, parseExportPresetFile, serializeExportPresetFile, type ExportPresetFile, type ImportedExportPresets } from '../shared/export-preset-file'
import { atomicWrite, canonicalPath, serialized } from './files'
import { DesktopError, invalid } from './errors'
import { readFileSnapshot } from './file-snapshot'

export async function readExportPresetFile(filename: string): Promise<ExportPresetFile> {
  const info = await fs.lstat(filename)
  if (!info.isFile() || info.isSymbolicLink()) invalid('预设文件必须是普通 JSON 文件。')
  if (info.size > MAX_EXPORT_PRESET_FILE_BYTES) invalid('预设文件超过 256 KB。')
  const { bytes } = await readFileSnapshot(filename, MAX_EXPORT_PRESET_FILE_BYTES, info)
  try { return parseExportPresetFile(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch (error) { invalid(error instanceof Error ? error.message : '预设文件无效。') }
}

export async function importExportPresets(window: BrowserWindow): Promise<ImportedExportPresets | null> {
  const choice = await dialog.showOpenDialog(window, { title: '导入导出预设', properties: ['openFile'], filters: [{ name: 'QTypora 预设 JSON', extensions: ['json'] }] })
  if (choice.canceled || !choice.filePaths.length) return null
  const filename = choice.filePaths[0]
  return { fileName: path.basename(filename), data: await readExportPresetFile(filename) }
}

export async function writeExportPresetFile(filename: string, presets: unknown, sourcePaths: () => string[]): Promise<string> {
  let text: string
  try { text = serializeExportPresetFile(presets) }
  catch (error) { invalid(error instanceof Error ? error.message : '导出预设无效。') }
  if (path.extname(filename).toLowerCase() !== '.json') invalid('预设文件需要 .json 扩展名。')
  const destination = path.join(await canonicalPath(path.dirname(path.resolve(filename))), path.basename(filename))
  const checkSource = async () => {
    const target = destination.toLowerCase()
    for (const source of sourcePaths()) {
      let resolved = path.resolve(source)
      try { resolved = await canonicalPath(source) } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
      if (resolved.toLowerCase() === target) throw new DesktopError('CONFLICT', '预设文件不能覆盖已打开的文档，请另选文件名。')
    }
  }
  const version = async (): Promise<string | null> => {
    try {
      const stat = await fs.lstat(destination, { bigint: true })
      if (!stat.isFile() || stat.isSymbolicLink()) throw new DesktopError('PERMISSION_DENIED', '不能覆盖符号链接或非普通文件。')
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
    } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null; throw error }
  }
  await checkSource()
  const expected = await version()
  await serialized(destination.toLowerCase(), () => atomicWrite(destination, Buffer.from(text, 'utf8'), async () => {
    await checkSource()
    if (await version() !== expected) throw new DesktopError('CONFLICT', '导出期间目标预设文件发生改变，未覆盖外部修改。')
  }))
  return destination
}

export async function exportExportPresets(window: BrowserWindow, input: unknown, sourcePaths: () => string[]): Promise<string | null> {
  // Validate before showing the native picker; this API accepts only presentation presets.
  try { serializeExportPresetFile(input) } catch (error) { invalid(error instanceof Error ? error.message : '导出预设无效。') }
  const choice = await dialog.showSaveDialog(window, { title: '导出预设 JSON', defaultPath: 'qtypora-export-presets.json', filters: [{ name: 'QTypora 预设 JSON', extensions: ['json'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] })
  if (choice.canceled || !choice.filePath) return null
  return writeExportPresetFile(choice.filePath, input, sourcePaths)
}
