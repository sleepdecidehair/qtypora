import * as fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_PREFERENCES, type DraftRecord, type Preferences } from '../shared/contracts'
import { atomicWrite, serialized } from './files'
import { boolean, invalid, object, string } from './errors'
import { normalizeExportOptions } from '../shared/export-options'
import { normalizeMarkdownOptions } from '../shared/markdown-options'
import { normalizeWorkspaceOptions } from '../shared/workspace-options'
import { normalizeShortcutOverrides } from '../shared/shortcuts'
import { normalizeImageOptions } from '../shared/image-options'

export function validatePreferences(input: unknown): Preferences {
  const value = object(input)
  if (!['light', 'dark', 'system'].includes(typeof value.theme === 'string' ? value.theme : '')) invalid('主题无效。')
  if (!['files', 'outline', 'search'].includes(typeof value.sidebarMode === 'string' ? value.sidebarMode : '')) invalid('侧栏模式无效。')
  if (!['LF', 'CRLF'].includes(typeof value.lineEnding === 'string' ? value.lineEnding : '')) invalid('换行格式无效。')
  if (value.readingMode !== undefined) boolean(value.readingMode, '旧版阅读模式')
  const number = (key: string, min: number, max: number): number => {
    const candidate = value[key]
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < min || candidate > max) invalid(`${key}超出允许范围。`)
    return candidate
  }
  const contentWidth = number('contentWidth', 480, 1440)
  // Legacy defaults become fluid; explicitly customized widths remain fixed.
  const contentWidthMode = value.contentWidthMode === undefined
    ? (contentWidth === DEFAULT_PREFERENCES.contentWidth ? 'auto' : 'fixed') : value.contentWidthMode
  if (contentWidthMode !== 'auto' && contentWidthMode !== 'fixed') invalid('正文宽度模式无效。')
  const optionalNumber = (key: 'readingSpeed' | 'lineHeight' | 'zoomFactor', min: number, max: number): number => {
    const candidate = value[key] ?? DEFAULT_PREFERENCES[key]
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < min || candidate > max) invalid(`${key}超出允许范围。`)
    return candidate
  }
  const optionalText = (key: 'fontFamily' | 'customCss' | 'startupFolder', max: number): string => {
    const candidate = value[key] ?? DEFAULT_PREFERENCES[key]
    if (typeof candidate !== 'string' || candidate.length > max || candidate.includes('\0')) invalid(`${key}无效。`)
    return candidate
  }
  const lightTheme = value.lightTheme ?? 'paper'
  const darkTheme = value.darkTheme ?? 'night'
  const startup = value.startup ?? 'new'
  if (!['paper', 'sepia', 'blue'].includes(typeof lightTheme === 'string' ? lightTheme : '') || !['night', 'charcoal'].includes(typeof darkTheme === 'string' ? darkTheme : '')) invalid('配色无效。')
  if (!['new', 'last-file', 'last-folder', 'custom-folder'].includes(typeof startup === 'string' ? startup : '')) invalid('启动方式无效。')
  const spellcheckLanguages = value.spellcheckLanguages ?? ['en-US']
  const statisticsUnit = value.statisticsUnit === undefined ? DEFAULT_PREFERENCES.statisticsUnit : value.statisticsUnit
  if (statisticsUnit !== 'words' && statisticsUnit !== 'characters') invalid('统计单位无效。')
  if (!Array.isArray(spellcheckLanguages) || spellcheckLanguages.length > 8 || !spellcheckLanguages.every(item => typeof item === 'string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(item))) invalid('拼写检查语言无效。')
  let extensions: Pick<Preferences, 'markdown' | 'workspace' | 'image' | 'export' | 'shortcuts'>
  try { extensions = { shortcuts: normalizeShortcutOverrides(value.shortcuts, process.platform), markdown: normalizeMarkdownOptions(value.markdown), workspace: normalizeWorkspaceOptions(value.workspace), image: normalizeImageOptions(value.image), export: normalizeExportOptions(value.export) } }
  catch (error) { invalid(error instanceof Error ? error.message : '扩展设置无效。') }
  return {
    ...extensions,
    theme: value.theme as Preferences['theme'], sidebarMode: value.sidebarMode as Preferences['sidebarMode'],
    lineEnding: value.lineEnding as Preferences['lineEnding'], fontSize: number('fontSize', 12, 32),
    contentWidth, contentWidthMode, autoSaveSeconds: number('autoSaveSeconds', 5, 3600),
    showSidebar: boolean(value.showSidebar, '侧栏'), showToolbar: boolean(value.showToolbar, '工具栏'),
    sourceMode: boolean(value.sourceMode, '源码模式'), focusMode: boolean(value.focusMode, '专注模式'),
    readingMode: false, floatingToolbar: value.floatingToolbar === undefined ? true : boolean(value.floatingToolbar, '浮动工具栏'),
    typewriterMode: boolean(value.typewriterMode, '打字机模式'), autoSave: boolean(value.autoSave, '自动保存'),
    spellcheck: boolean(value.spellcheck, '拼写检查'), showLineNumbers: boolean(value.showLineNumbers, '行号'),
    wrapLines: boolean(value.wrapLines, '自动折行'),
    readingSpeed: optionalNumber('readingSpeed', 50, 2000), statisticsUnit, lineHeight: optionalNumber('lineHeight', 1, 3), zoomFactor: optionalNumber('zoomFactor', 0.5, 2),
    fontFamily: optionalText('fontFamily', 200), customCss: optionalText('customCss', 40000), startupFolder: optionalText('startupFolder', 4096),
    lightTheme: lightTheme as Preferences['lightTheme'], darkTheme: darkTheme as Preferences['darkTheme'], startup: startup as Preferences['startup'], spellcheckLanguages,
  }
}

export class LocalStore {
  preferences: Preferences = { ...DEFAULT_PREFERENCES }
  recentFiles: string[] = []
  recentFolders: string[] = []
  drafts = new Map<string, DraftRecord>()
  private unknownSettings: Record<string, unknown> = {}
  private unknownPreferences: Record<string, unknown> = {}
  constructor(private readonly directory: string) {}

  async load(): Promise<void> {
    await fs.mkdir(path.join(this.directory, 'drafts'), { recursive: true })
    try {
      const settings = object(JSON.parse(await fs.readFile(path.join(this.directory, 'settings.json'), 'utf8')) as unknown)
      const storedPreferences = object(settings.preferences)
      this.unknownSettings = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'preferences' && key !== 'recentFiles'))
      this.unknownPreferences = Object.fromEntries(Object.entries(storedPreferences).filter(([key]) => !Object.hasOwn(DEFAULT_PREFERENCES, key)))
      this.preferences = validatePreferences(settings.preferences)
      if (Array.isArray(settings.recentFiles)) this.recentFiles = settings.recentFiles.filter((item): item is string => typeof item === 'string').slice(0, 20)
      if (Array.isArray(settings.recentFolders)) this.recentFolders = settings.recentFolders.filter((item): item is string => typeof item === 'string' && path.isAbsolute(item)).slice(0, 20)
    } catch (error) {
      if (!isMissing(error)) console.error('[store] Settings invalid; defaults restored')
    }
    for (const file of await fs.readdir(path.join(this.directory, 'drafts'))) {
      if (!/^[a-f0-9-]+\.json$/i.test(file)) continue
      try {
        const value = object(JSON.parse(await fs.readFile(path.join(this.directory, 'drafts', file), 'utf8')) as unknown)
        const draft: DraftRecord = {
          id: string(value.id, '草稿 ID', 100), name: string(value.name, '草稿名称', 300),
          path: value.path === null ? null : string(value.path, '路径'),
          content: typeof value.content === 'string' && value.content.length <= 16 * 1024 * 1024 ? value.content : invalid('草稿内容无效。'),
          revision: typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : invalid('草稿版本无效。'),
          updatedAt: string(value.updatedAt, '时间', 100),
        }
        if (!/^[a-f0-9-]+$/i.test(draft.id) || `${draft.id}.json` !== file) invalid('草稿名称无效。')
        this.drafts.set(draft.id, draft)
      } catch { console.error('[store] Invalid draft retained on disk for manual recovery') }
    }
  }

  async updatePreferences(preferences: Preferences): Promise<Preferences> {
    return serialized('settings:' + this.directory, async () => {
      await this.writeSettings(preferences)
      this.preferences = preferences
      return preferences
    })
  }

  async addRecent(filePath: string): Promise<void> {
    this.recentFiles = [filePath, ...this.recentFiles.filter((item) => item.toLowerCase() !== filePath.toLowerCase())].slice(0, 20)
    await this.persistSettings()
  }

  async addRecentFolder(folderPath: string): Promise<void> {
    this.recentFolders = [folderPath, ...this.recentFolders.filter(item => item !== folderPath)].slice(0, 20)
    await this.persistSettings()
  }

  private async persistSettings(): Promise<void> {
    await serialized('settings:' + this.directory, () => this.writeSettings(this.preferences))
  }

  private async writeSettings(preferences: Preferences): Promise<void> {
    await atomicWrite(path.join(this.directory, 'settings.json'), Buffer.from(JSON.stringify({
      ...this.unknownSettings, preferences: { ...this.unknownPreferences, ...preferences }, recentFiles: this.recentFiles, recentFolders: this.recentFolders,
    }, null, 2)))
  }

  async writeDraft(draft: DraftRecord): Promise<void> {
    if (!/^[a-f0-9-]+$/i.test(draft.id)) invalid('草稿 ID 无效。')
    this.drafts.set(draft.id, draft)
    await serialized('draft:' + draft.id, () => atomicWrite(path.join(this.directory, 'drafts', `${draft.id}.json`), Buffer.from(JSON.stringify(draft))))
  }

  async discardDraft(id: string): Promise<void> {
    if (!/^[a-f0-9-]+$/i.test(id)) invalid('草稿 ID 无效。')
    this.drafts.delete(id)
    await serialized('draft:' + id, async () => {
      try { await fs.unlink(path.join(this.directory, 'drafts', `${id}.json`)) }
      catch (error) { if (!isMissing(error)) throw error }
    })
  }
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}
