import { useTranslation } from '../i18n/locale'
import { useEffect, useRef, useState } from 'react'
import { createWorkerWritingStatisticsScheduler, createWritingStatisticsScheduler, type WritingStatistics, type WritingStatisticsRequest, type WritingStatisticsScheduler, type WritingStatisticsSnapshot } from '../hooks/wordStatistics'
import { DEFAULT_MARKDOWN_OPTIONS, type MarkdownOptions } from '../../shared/markdown-options'
import type { Preferences } from '../../shared/contracts'

export interface WordStatisticsProps {
  content: string
  selectedText?: string
  readingSpeed?: number
  markdownOptions?: MarkdownOptions
  unit: Preferences['statisticsUnit']
  onUnitChange: (unit: Preferences['statisticsUnit']) => void
}

const EMPTY_STATISTICS: WritingStatistics = { words: 0, characters: 0, charactersWithoutSpaces: 0, paragraphs: 0, lines: 0, readingMinutes: 0 }

function useScheduledStatistic(content: string, readingSpeed: number, markdownOptions: MarkdownOptions): { statistics: WritingStatistics; pending: boolean; failed: boolean } {
  const [snapshot, setSnapshot] = useState<WritingStatisticsSnapshot | null>(null)
  const [failure, setFailure] = useState<WritingStatisticsRequest | null>(null)
  const scheduler = useRef<WritingStatisticsScheduler | null>(null)
  useEffect(() => {
    const current = typeof Worker === 'function' ? createWorkerWritingStatisticsScheduler(setSnapshot, undefined, setFailure) : createWritingStatisticsScheduler(setSnapshot)
    scheduler.current = current
    return () => { if (scheduler.current === current) scheduler.current = null; current.dispose() }
  }, [])
  useEffect(() => {
    const current = scheduler.current
    if (!current) return
    if (!content) { current.release(); setFailure(null); return }
    setFailure(null)
    current.request({ content, readingSpeed, markdownOptions })
    return () => current.cancel()
  }, [content, readingSpeed, markdownOptions])
  if (!content) return { statistics: EMPTY_STATISTICS, pending: false, failed: false }
  const isCurrent = snapshot?.content === content && snapshot.readingSpeed === readingSpeed && snapshot.markdownOptions === markdownOptions
  const failed = failure?.content === content && failure.readingSpeed === readingSpeed && failure.markdownOptions === markdownOptions
  return { statistics: isCurrent ? snapshot.statistics : EMPTY_STATISTICS, pending: !isCurrent && !failed, failed }
}

function useDocumentStatistics(content: string, selectedText: string, readingSpeed: number, markdownOptions: MarkdownOptions) {
  const total = useScheduledStatistic(content, readingSpeed, markdownOptions)
  const selectedSource = selectedText === content ? '' : selectedText
  const selectedResult = useScheduledStatistic(selectedSource, readingSpeed, markdownOptions)
  const selected = selectedText ? selectedText === content ? total.statistics : selectedResult.statistics : null
  const failed = total.failed || Boolean(selectedText && (selectedText === content ? total.failed : selectedResult.failed))
  return { total: total.statistics, selected, pending: total.pending || Boolean(selectedText && (selectedText === content ? total.pending : selectedResult.pending)), failed }
}

export function WordStatisticsPanel({ content, selectedText = '', readingSpeed = 300, markdownOptions = DEFAULT_MARKDOWN_OPTIONS, unit, onUnitChange, inDialog = false }: WordStatisticsProps & { inDialog?: boolean }) {
  const { total, selected, pending, failed } = useDocumentStatistics(content, selectedText, readingSpeed, markdownOptions)
  return <StatisticsDetails total={total} selected={selected} pending={pending} failed={failed} readingSpeed={readingSpeed} unit={unit} onUnitChange={onUnitChange} inDialog={inDialog} />
}

function StatisticsDetails({ total, selected, pending, failed, readingSpeed, unit, onUnitChange, inDialog = false }: Pick<WordStatisticsProps, 'unit' | 'onUnitChange'> & { total: WritingStatistics; selected: WritingStatistics | null; pending: boolean; failed: boolean; readingSpeed: number; inDialog?: boolean }) {
  const t = useTranslation()
  const rows = [['字数', 'words'], ['字符数（含语法）', 'characters'], ['字符数（不含空白）', 'charactersWithoutSpaces'], ['段落', 'paragraphs'], ['行数', 'lines'], ['阅读时间（分钟）', 'readingMinutes']] as const
  return <section id={inDialog ? undefined : 'word-statistics-panel'} className={`word-statistics-panel${inDialog ? ' is-dialog' : ''}`} aria-label={t('文章统计详情')} aria-busy={pending}>
    {!inDialog ? <h2>{t('文章统计')}</h2> : null}<table><thead><tr><th>{t('项目')}</th>{selected ? <th>{t('选中')}</th> : null}<th>{t('全文')}</th></tr></thead><tbody>{rows.map(([label, key]) => <tr key={key}><th>{t(label)}</th>{selected ? <td>{pending ? '…' : failed ? '—' : selected[key]}</td> : null}<td data-testid={`statistics-${key}`}>{pending ? '…' : failed ? '—' : total[key]}</td></tr>)}</tbody></table>
    <label>{t('状态栏单位')}<select aria-label={t('统计单位')} value={unit} onChange={event => onUnitChange(event.target.value === 'characters' ? 'characters' : 'words')}><option value="words">{t('字数')}</option><option value="characters">{t('字符数')}</option></select></label>
    <p>{t('中文按字计数，单词保留内部连字符；字数不含格式标记、链接地址和前置信息。阅读速度：')}{readingSpeed}{' '}{t('字/分钟。')}</p>
  </section>
}

export function WordStatistics({ content, selectedText = '', readingSpeed = 300, markdownOptions = DEFAULT_MARKDOWN_OPTIONS, unit, onUnitChange }: WordStatisticsProps) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { total, selected, pending, failed } = useDocumentStatistics(content, selectedText, readingSpeed, markdownOptions)
  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExpanded(false); root.current?.querySelector<HTMLButtonElement>('[data-testid="word-count"]')?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [expanded])
  return <div className="word-statistics" ref={root}>
    <button type="button" data-testid="word-count" aria-label={t('文章统计')} aria-busy={pending} aria-expanded={expanded} aria-controls="word-statistics-panel" title={pending || failed ? t('文章统计') : `${total.characters} ${t('字符')} · ${total.lines} ${t('行')}`} onClick={() => setExpanded(value => !value)}>{pending ? '…' : failed ? '—' : <>{selected ? `${t('选中')} ${selected[unit]} / ` : ''}{total[unit]} {unit === 'words' ? t('字') : t('字符')}</>}</button>
    {expanded ? <StatisticsDetails total={total} selected={selected} pending={pending} failed={failed} readingSpeed={readingSpeed} unit={unit} onUnitChange={onUnitChange} /> : null}
  </div>
}
