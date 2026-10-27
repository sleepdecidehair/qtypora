import { useLocale, useTranslation } from '../i18n/locale'
import { useEffect, useRef, useState } from 'react'
import type { DesktopApi, Result } from '../../shared/contracts'

export function SpellingDictionary({ api }: { api: DesktopApi }) {
  const t = useTranslation()
  const locale = useLocale()
  const [words, setWords] = useState<string[]>([])
  const [ignored, setIgnored] = useState<string[]>([])
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const mounted = useRef(false)
  useEffect(() => {
    let active = true
    mounted.current = true
    void Promise.allSettled([api.listSpellingWords(), api.listIgnoredSpellingWords()]).then(results => {
      if (!active) return
      const errors: string[] = []
      results.forEach((entry, index) => {
        if (entry.status === 'rejected') errors.push(t('无法读取拼写记录。'))
        else if (!entry.value.ok) errors.push(entry.value.error.message)
        else (index === 0 ? setWords : setIgnored)(entry.value.data)
      })
      setError(errors.join(' '))
    })
    return () => { active = false; mounted.current = false }
  }, [api])
  const forget = async (word: string) => {
    setPending(true)
    try {
      const result = await api.forgetSpelling(word)
      if (!mounted.current) return
      if (result.ok) { setWords(previous => previous.filter(item => item !== word)); setError('') }
      else setError(result.error.message)
    } catch { if (mounted.current) setError(t('无法修改拼写词典。')) }
    finally { if (mounted.current) setPending(false) }
  }
  const updateIgnored = async (operation: () => Promise<Result<string[]>>) => {
    setPending(true)
    try {
      const result = await operation()
      if (!mounted.current) return
      if (result.ok) { setIgnored(result.data); setError('') }
      else setError(result.error.message)
    } catch { if (mounted.current) setError(t('无法修改当前窗口的忽略记录。')) }
    finally { if (mounted.current) setPending(false) }
  }
  return <div>
    {error ? <p role="alert">{error}</p> : null}
    <details className="spelling-dictionary"><summary>{t('自定义拼写词典（')}{words.length}{locale === 'en-US' ? ')' : '）'}</summary>
      {words.length ? <ul>{words.map(word => <li key={word}><span>{word}</span><button type="button" disabled={pending} aria-label={`${t('忘记单词')} ${word}`} onClick={() => { void forget(word) }}>{t('移除')}</button></li>)}</ul> : <p className="setting-hint">{t('在编辑器右键菜单中将单词加入词典。')}</p>}
    </details>
    <details className="spelling-dictionary"><summary>{t('当前窗口忽略的拼写建议（')}{ignored.length}{locale === 'en-US' ? ')' : '）'}</summary>
      <p className="setting-hint">{t('只在当前窗口忽略，大小写不区分；刷新或关闭窗口后清空，不写入系统词典。原生红色波浪线可能仍保留。')}</p>
      {ignored.length ? <><ul>{ignored.map(word => <li key={word}><span>{word}</span><button type="button" disabled={pending} aria-label={`${t('恢复拼写建议')} ${word}`} onClick={() => { void updateIgnored(() => api.restoreSpelling(word)) }}>{t('恢复')}</button></li>)}</ul><button type="button" disabled={pending} onClick={() => { void updateIgnored(() => api.clearIgnoredSpellingWords()) }}>{t('清空当前窗口的忽略记录')}</button></> : <p className="setting-hint">{t('在编辑器右键菜单中忽略此词的拼写建议。')}</p>}
    </details>
  </div>
}
