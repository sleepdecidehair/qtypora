import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { writingStatistics } from '../hooks/wordStatistics'
import { DEFAULT_MARKDOWN_OPTIONS, type MarkdownOptions } from '../../shared/markdown-options'
import type { Preferences } from '../../shared/contracts'

interface WordStatisticsProps {
  content: string
  selectedText?: string
  readingSpeed?: number
  markdownOptions?: MarkdownOptions
  unit: Preferences['statisticsUnit']
  onUnitChange: (unit: Preferences['statisticsUnit']) => void
}

export function WordStatistics({ content, selectedText = '', readingSpeed = 300, markdownOptions = DEFAULT_MARKDOWN_OPTIONS, unit, onUnitChange }: WordStatisticsProps) {
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const deferred = useDeferredValue(content)
  const total = useMemo(() => writingStatistics(deferred, readingSpeed, markdownOptions), [deferred, readingSpeed, markdownOptions])
  const selected = useMemo(() => selectedText ? writingStatistics(selectedText, readingSpeed, markdownOptions) : null, [selectedText, readingSpeed, markdownOptions])
  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExpanded(false); root.current?.querySelector<HTMLButtonElement>('[data-testid="word-count"]')?.focus() } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [expanded])
  const rows = [['字数', 'words'], ['字符数（含语法）', 'characters'], ['字符数（不含空白）', 'charactersWithoutSpaces'], ['段落', 'paragraphs'], ['行数', 'lines'], ['阅读时间（分钟）', 'readingMinutes']] as const
  return <div className="word-statistics" ref={root}>
    <button type="button" data-testid="word-count" aria-label="文章统计" aria-expanded={expanded} aria-controls="word-statistics-panel" title={`${total.characters} 字符 · ${total.lines} 行`} onClick={() => setExpanded(value => !value)}>{selected ? `选中 ${selected[unit]} / ` : ''}{total[unit]} {unit === 'words' ? '字' : '字符'}</button>
    {expanded ? <section id="word-statistics-panel" className="word-statistics-panel" aria-label="文章统计详情">
      <h2>文章统计</h2><table><thead><tr><th>项目</th>{selected ? <th>选中</th> : null}<th>全文</th></tr></thead><tbody>{rows.map(([label, key]) => <tr key={key}><th>{label}</th>{selected ? <td>{selected[key]}</td> : null}<td data-testid={`statistics-${key}`}>{total[key]}</td></tr>)}</tbody></table>
      <label>状态栏单位<select aria-label="统计单位" value={unit} onChange={event => onUnitChange(event.target.value === 'characters' ? 'characters' : 'words')}><option value="words">字数</option><option value="characters">字符数</option></select></label>
      <p>中文按字计数，单词保留内部连字符；字数不含格式标记、链接地址和前置信息。阅读速度：{readingSpeed} 字/分钟。</p>
    </section> : null}
  </div>
}
