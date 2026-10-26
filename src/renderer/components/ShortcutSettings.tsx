import { useEffect, useState } from 'react'
import { defaultShortcut, normalizeShortcutOverrides, SHORTCUT_DEFINITIONS, shortcutForCommand, type ShortcutCommand, type ShortcutOverrides } from '../../shared/shortcuts'

interface ShortcutSettingsProps { platform: string; shortcuts: ShortcutOverrides; onChange: (shortcuts: ShortcutOverrides) => void; filter?: string }

function ShortcutRow({ command, label, platform, shortcuts, onChange }: ShortcutSettingsProps & { command: ShortcutCommand; label: string }) {
  const current = shortcutForCommand(command, platform, shortcuts) ?? ''
  const [draft, setDraft] = useState(current)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(current); setError('') }, [current])
  const commit = () => {
    if (draft === current) return
    try { onChange(normalizeShortcutOverrides({ ...shortcuts, [command]: draft }, platform)); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '快捷键无效') }
  }
  const reset = () => {
    const next = { ...shortcuts }; delete next[command]
    try { onChange(normalizeShortcutOverrides(next, platform)); setDraft(defaultShortcut(command, platform) ?? ''); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '快捷键冲突') }
  }
  return <div className="shortcut-row"><label>{label}<input aria-label={`${label}快捷键`} value={draft} aria-invalid={Boolean(error)} placeholder="未设置" maxLength={80} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} /></label><button type="button" title={`恢复默认：${defaultShortcut(command, platform) ?? '未设置'}`} onClick={reset}>恢复默认</button>{error ? <p role="alert">{error}</p> : null}</div>
}

export function ShortcutSettings({ platform, shortcuts, onChange, filter = '' }: ShortcutSettingsProps) {
  const query = filter.trim().toLocaleLowerCase()
  const rows = SHORTCUT_DEFINITIONS.filter(item => !query || '快捷键'.includes(query) || item.label.toLocaleLowerCase().includes(query))
  if (!rows.length) return null
  return <section className="shortcut-settings"><h3>快捷键</h3><p className="setting-hint">输入 Ctrl、CmdOrCtrl、Alt、Shift 与按键组合，例如 CmdOrCtrl+Alt+S；离开输入框后生效。留空禁用该菜单快捷键。复制、撤销、查找和编辑器格式按键保留固定设置。</p>
    <details open={Boolean(query)}><summary>自定义应用快捷键</summary>{rows.map(item => <ShortcutRow key={item.command} command={item.command} label={item.label} platform={platform} shortcuts={shortcuts} onChange={onChange} />)}</details>
    <button type="button" className="text-button" onClick={() => onChange({})}>恢复所有默认快捷键</button>
  </section>
}
