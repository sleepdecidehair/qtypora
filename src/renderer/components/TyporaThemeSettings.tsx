import { useCallback, useEffect, useRef, useState } from 'react'
import type { Result } from '../../shared/contracts'
import { compileTyporaTheme } from '../hooks/typora-theme'
import { useTranslation } from '../i18n/locale'

export interface ThemeFile { id: string; name: string }
export interface ThemeSnapshot extends ThemeFile { css: string; globalCss: string; overrideCss: string; version: string }
export interface TyporaThemeApi {
  listUserThemes(): Promise<Result<ThemeFile[]>>
  readUserTheme(id: string): Promise<Result<ThemeSnapshot>>
  revealUserThemes(): Promise<Result<void>>
}

/** Validate every layer before persisting a theme selection. */
export async function validateThemeSelection(api: TyporaThemeApi, id: string, compile = compileTyporaTheme): Promise<string | null> {
  if (!id) return null
  try {
    const result = await api.readUserTheme(id)
    if (!result.ok) return result.error.message
    if (result.data.id !== id) return '读取到的主题与所选主题不一致。'
    for (const css of [result.data.css, result.data.globalCss, result.data.overrideCss]) compile(css)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : '无法读取主题。'
  }
}

export function TyporaThemeSettings({ api, selectedId, onChange, onRefresh }: { api: TyporaThemeApi; selectedId: string; onChange: (id: string) => void; onRefresh?: (id: string) => void }) {
  const t = useTranslation()
  const [themes, setThemes] = useState<ThemeFile[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const generation = useRef(0)
  const listGeneration = useRef(0)
  const alive = useRef(true)
  const selectedRef = useRef(selectedId)
  const refreshCallback = useRef(onRefresh)
  selectedRef.current = selectedId
  refreshCallback.current = onRefresh
  const refresh = useCallback(async (reloadCurrent = false) => {
    const request = ++listGeneration.current
    const current = selectedRef.current
    try {
      const result = await api.listUserThemes()
      if (!alive.current || request !== listGeneration.current) return
      if (result.ok) { setThemes(result.data); setError(''); if (reloadCurrent && current && selectedRef.current === current) refreshCallback.current?.(current) }
      else setError(result.error.message)
    } catch (reason) {
      if (alive.current && request === listGeneration.current) setError(reason instanceof Error ? reason.message : t('无法读取主题目录。'))
    }
  }, [api, t])
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; generation.current++; listGeneration.current++ } }, [refresh])
  useEffect(() => { generation.current++; setPending(false) }, [selectedId])
  const select = async (id: string) => {
    const request = ++generation.current
    setPending(true)
    const message = await validateThemeSelection(api, id)
    if (!alive.current || request !== generation.current) return
    setPending(false)
    if (message) setError(message)
    else { setError(''); onChange(id) }
  }
  const reveal = async () => {
    try {
      const result = await api.revealUserThemes()
      if (alive.current) setError(result.ok ? '' : result.error.message)
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : t('无法打开主题目录。')) }
  }
  return <div>
    <label className="setting-row">{t('Typora 主题')}<select aria-label={t('Typora 主题')} value={selectedId} disabled={pending} onChange={event => { void select(event.target.value) }}>
      <option value="">{t('不使用')}</option>
      {selectedId && !themes.some(theme => theme.id === selectedId) ? <option value={selectedId}>{selectedId}</option> : null}
      {themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
    </select></label>
    <div><button type="button" onClick={() => { void refresh(true) }}>{t('刷新主题')}</button> <button type="button" onClick={() => { void reveal() }}>{t('打开主题目录')}</button></div>
    {error ? <p role="alert" className="setting-hint">{t(error)}</p> : null}
    <p className="setting-hint">{t('支持正文、标题、表格及部分文本样式、简单变量和有限的媒体查询；其他选择器和属性会被忽略。不支持导入、外部字体或图片资源。')}</p>
  </div>
}
