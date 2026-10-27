import { useLocale, useTranslation } from '../i18n/locale'
import { translateKnownError } from '../../shared/i18n'
import { useState } from 'react'
import { normalizeCustomExport, type CustomExportPreset } from '../../shared/custom-export'
import type { ExportOptions } from '../../shared/export-options'

const emptyPreset: CustomExportPreset = { name: '', extension: 'html', executable: '', args: ['{input}', '{output}'], input: 'markdown', template: '' }

export function CustomExportSettings({ options, onChange }: { options: ExportOptions; onChange: (options: ExportOptions) => void }) {
  const t = useTranslation()
  const locale = useLocale()
  const [draft, setDraft] = useState<CustomExportPreset>(emptyPreset)
  const [error, setError] = useState('')
  const save = () => {
    try {
      const presets = normalizeCustomExport([...options.customPresets.filter(item => item.name !== draft.name.trim()), draft])
      onChange({ ...options, customPresets: presets, customPreset: draft.name.trim() })
      setError('')
    } catch (error) { setError(error instanceof Error ? translateKnownError(locale, error.message) : t('配置无效。')) }
  }
  return <details className="custom-export-settings"><summary>{t('自定义导出程序与模板')}</summary>
    <label className="setting-row">{t('当前配置')}<select aria-label={t('自定义导出配置')} value={options.customPreset} onChange={event => onChange({ ...options, customPreset: event.target.value })}>
      <option value="">{t('未选择')}</option>{options.customPresets.map(item => <option key={item.name}>{item.name}</option>)}
    </select></label>
    <div className="setting-actions"><button type="button" onClick={() => { setDraft(options.customPresets.find(item => item.name === options.customPreset) ?? emptyPreset); setError('') }}>{t('编辑所选配置')}</button><button type="button" disabled={!options.customPreset} onClick={() => onChange({ ...options, customPresets: options.customPresets.filter(item => item.name !== options.customPreset), customPreset: '' })}>{t('删除所选配置')}</button></div>
    <label className="setting-row">{t('配置名称')}<input aria-label={t('导出配置名称')} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
    <label className="setting-row">{t('输出扩展名')}<input aria-label={t('导出扩展名')} value={draft.extension} onChange={event => setDraft({ ...draft, extension: event.target.value })} /></label>
    <label className="setting-row">{t('导出程序路径')}<input aria-label={t('导出程序路径')} placeholder={t('绝对路径')} value={draft.executable} onChange={event => setDraft({ ...draft, executable: event.target.value })} /></label>
    <label className="setting-row">{t('输入格式')}<select aria-label={t('自定义导出输入格式')} value={draft.input} onChange={event => setDraft({ ...draft, input: event.target.value as CustomExportPreset['input'] })}><option value="markdown">{t('Markdown 原文')}</option><option value="html">{t('渲染后的 HTML')}</option></select></label>
    <label className="setting-row">{t('程序参数（每行一个）')}<textarea aria-label={t('自定义导出参数')} rows={4} value={draft.args.join('\n')} onChange={event => setDraft({ ...draft, args: event.target.value.split('\n') })} /></label>
    <label className="setting-row">{t('模板路径（可选）')}<input aria-label={t('导出模板路径')} value={draft.template} onChange={event => setDraft({ ...draft, template: event.target.value })} /></label>
    <p className="setting-hint">{'{input}'}{' '}{t('为输入文件，')}{'{output}'}{' '}{t('为程序应生成的文件，')}{'{template}'}{' '}{t('为可选模板。每行作为一个参数传递；不使用 Shell。输出成功后才写入目标文件。')}</p>
    {error ? <p role="alert">{error}</p> : null}<button type="button" onClick={save}>{t('保存导出配置')}</button>
  </details>
}
