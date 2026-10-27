import { useLocale, useTranslation } from '../i18n/locale'
import { translateKnownError } from '../../shared/i18n'
import { useState } from 'react'
import { EXPORT_FORMATS, exportPresetSettings, normalizeExportOptions, type ExportFormat, type ExportOptions, type SavedExportPreset } from '../../shared/export-options'
import { Dialog } from './Dialog'
import type { DesktopApi } from '../../shared/contracts'
import { renameExportPreset, type PresetConflictStrategy } from '../../shared/export-preset-file'
import { ExportPresetFiles } from './ExportPresetFiles'

const names: Record<ExportFormat, string> = { html: 'HTML', 'html-plain': 'HTML（无样式）', pdf: 'PDF', png: 'PNG 长图', markdown: 'Markdown 原文', gfm: 'GitHub Flavored Markdown', commonmark: 'CommonMark', plain: '纯文本 (.txt)', docx: 'Word (.docx)', odt: 'OpenDocument (.odt)', rtf: 'RTF', epub: 'EPUB', latex: 'LaTeX', mediawiki: 'MediaWiki', rst: 'reStructuredText', textile: 'Textile', opml: 'OPML', revealjs: 'Reveal.js 演示文稿', pptx: 'PowerPoint (.pptx)', beamer: 'Beamer (.tex)', custom: '自定义导出程序' }

export function ExportDialog({ desktopApi, options, onOptionsChange, onImportPresets, onExport, onSettings, onClose }: { desktopApi: DesktopApi; options: ExportOptions; onOptionsChange: (options: ExportOptions) => void; onImportPresets: (presets: SavedExportPreset[], strategy: PresetConflictStrategy) => Promise<void>; onExport: (format: ExportFormat) => Promise<void>; onSettings: () => void; onClose: () => void }) {
  const t = useTranslation()
  const locale = useLocale()
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [pending, setPending] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [selectedPresetName, setSelectedPresetName] = useState('')
  const [error, setError] = useState('')
  const savePreset = () => {
    if (format === 'custom') return
    try {
      const name = presetName.trim()
      onOptionsChange(normalizeExportOptions({ ...options, savedPresets: [...options.savedPresets.filter(item => item.name !== name), { name, format, settings: exportPresetSettings(options) }] }))
      setSelectedPresetName(name)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? translateKnownError(locale, cause.message) : t('导出预设无效。')) }
  }
  return <Dialog title={t('导出文档')} onClose={onClose}>
    <div className="dialog-content"><label className="setting-row">{t('格式')}<select aria-label={t('导出格式')} value={format} onChange={event => setFormat(event.target.value as ExportFormat)}>{EXPORT_FORMATS.map(kind => <option key={kind} value={kind}>{t(names[kind])}</option>)}</select></label>
      <label className="setting-row">{t('已保存的预设')}<select aria-label={t('选择导出预设')} value={options.savedPresets.some(item => item.name === selectedPresetName) ? selectedPresetName : ''} onChange={event => {
        const preset = options.savedPresets.find(item => item.name === event.target.value)
        setSelectedPresetName(preset?.name ?? '')
        if (preset) { setPresetName(preset.name); setFormat(preset.format); onOptionsChange({ ...options, ...preset.settings }); setError('') }
      }}><option value="">{t('选择预设…')}</option>{options.savedPresets.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
      <label className="setting-row">{t('预设名称')}<input aria-label={t('内建导出预设名称')} value={presetName} maxLength={80} onChange={event => setPresetName(event.target.value)} /></label>
      <div className="setting-actions"><button disabled={format === 'custom' || !presetName.trim()} onClick={savePreset}>{t('保存当前导出预设')}</button><button disabled={!selectedPresetName || !presetName.trim() || presetName.trim() === selectedPresetName} onClick={() => {
        try {
          onOptionsChange({ ...options, savedPresets: renameExportPreset(options.savedPresets, selectedPresetName, presetName) })
          setSelectedPresetName(presetName.trim()); setError('')
        } catch (cause) { setError(cause instanceof Error ? translateKnownError(locale, cause.message) : t('重命名失败。')) }
      }}>{t('重命名所选预设')}</button><button disabled={!options.savedPresets.some(item => item.name === selectedPresetName)} onClick={() => { onOptionsChange({ ...options, savedPresets: options.savedPresets.filter(item => item.name !== selectedPresetName) }); setPresetName(''); setSelectedPresetName('') }}>{t('删除此导出预设')}</button></div>
      <ExportPresetFiles api={desktopApi} options={options} onImportPresets={onImportPresets} />
      {error ? <p role="alert">{error}</p> : null}
      {!['html', 'html-plain', 'pdf', 'png', 'markdown', 'custom'].includes(format) ? <p className="setting-hint">{t('此格式使用本机 Pandoc 转换。可在偏好设置中指定 Pandoc 路径。')}</p> : null}
      {format === 'custom' ? <p className="setting-hint">{t('使用偏好设置中选中的自定义程序、参数和模板。')}</p> : null}
      <p className="setting-hint">{t('预设保存格式、主题、纸张、页边距、页眉页脚和长图宽度。同名保存更新已有预设；通过下方导出设置修改这些选项。')}</p>
    </div><div className="dialog-footer"><button className="text-button" onClick={onSettings}>{t('导出设置')}</button><button className="primary-button" disabled={pending} onClick={() => { setPending(true); void onExport(format).finally(() => setPending(false)) }}>{pending ? t('正在导出…') : t('导出…')}</button></div>
  </Dialog>
}
