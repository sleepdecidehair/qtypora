import { useLocale, useTranslation } from '../i18n/locale'
import { useEffect, useState } from 'react'
import { defaultShortcut, normalizeShortcutOverrides, SHORTCUT_DEFINITIONS, shortcutForCommand, type ShortcutCommand, type ShortcutOverrides } from '../../shared/shortcuts'
import { translateShortcutError } from '../../shared/i18n'

interface ShortcutSettingsProps { platform: string; shortcuts: ShortcutOverrides; onChange: (shortcuts: ShortcutOverrides) => void; filter?: string }

function ShortcutRow({ command, label, platform, shortcuts, onChange }: ShortcutSettingsProps & { command: ShortcutCommand; label: string }) {
  const t = useTranslation()
  const locale = useLocale()
  const current = shortcutForCommand(command, platform, shortcuts) ?? ''
  const [draft, setDraft] = useState(current)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(current); setError('') }, [current])
  const commit = () => {
    if (draft === current) return
    try { onChange(normalizeShortcutOverrides({ ...shortcuts, [command]: draft }, platform)); setError('') }
    catch (failure) { setError(failure instanceof Error ? translateShortcutError(locale, failure.message) : t('快捷键无效')) }
  }
  const reset = () => {
    const next = { ...shortcuts }; delete next[command]
    try { onChange(normalizeShortcutOverrides(next, platform)); setDraft(defaultShortcut(command, platform) ?? ''); setError('') }
    catch (failure) { setError(failure instanceof Error ? translateShortcutError(locale, failure.message) : t('快捷键冲突')) }
  }
  return <div className="shortcut-row"><label>{t(label)}<input aria-label={locale === 'en-US' ? `${t(label)} shortcut` : `${label}快捷键`} value={draft} aria-invalid={Boolean(error)} placeholder={t('未设置')} maxLength={80} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} /></label><button type="button" title={`${t('恢复默认')}：${defaultShortcut(command, platform) ?? t('未设置')}`} onClick={reset}>{t('恢复默认')}</button>{error ? <p role="alert">{error}</p> : null}</div>
}

export function ShortcutSettings({ platform, shortcuts, onChange, filter = '' }: ShortcutSettingsProps) {
  const t = useTranslation()
  const query = filter.trim().toLocaleLowerCase()
  const rows = SHORTCUT_DEFINITIONS.filter(item => !query || '快捷键'.includes(query) || t('快捷键').toLocaleLowerCase().includes(query) || item.label.toLocaleLowerCase().includes(query) || t(item.label).toLocaleLowerCase().includes(query))
  if (!rows.length) return null
  return <section className="shortcut-settings"><h3>{t('快捷键')}</h3><p className="setting-hint">{t('输入 Ctrl、CmdOrCtrl、Alt、Shift 与按键组合，例如 CmdOrCtrl+Alt+S；离开输入框后生效。留空禁用该菜单快捷键。复制、撤销、查找和编辑器格式按键保留固定设置。')}</p>
    <details open={Boolean(query)}><summary>{t('自定义应用快捷键')}</summary>{rows.map(item => <ShortcutRow key={item.command} command={item.command} label={item.label} platform={platform} shortcuts={shortcuts} onChange={onChange} />)}</details>
    <button type="button" className="text-button" onClick={() => onChange({})}>{t('恢复所有默认快捷键')}</button>
  </section>
}
