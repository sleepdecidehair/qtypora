import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, LocateFixed } from 'lucide-react'
import type { OutlineHeading } from '../hooks/outline'
import { currentOutlineLine, outlineRows } from '../hooks/outlineDisplay'
import { readReadingAnchor } from '../editor/semantic-scroll'

interface OutlinePanelProps { headings: OutlineHeading[]; name: string; documentId?: string; currentLine?: number; onJump: (line: number) => void }

export function OutlinePanel({ headings, name, documentId, currentLine = 1, onJump }: OutlinePanelProps) {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState(new Set<number>())
  const [numbered, setNumbered] = useState(false)
  const [activeLine, setActiveLine] = useState(currentLine)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { setActiveLine(currentLine) }, [currentLine])
  useEffect(() => { setCollapsed(new Set()); setFilter('') }, [documentId])
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')
    const article = scroller?.querySelector<HTMLElement>('.cm-content')
    if (!scroller || !article) return
    let frame: number | null = null
    const onScroll = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const anchor = readReadingAnchor(scroller, article)
        if (anchor) setActiveLine(anchor.line)
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => { scroller.removeEventListener('scroll', onScroll); if (frame !== null) cancelAnimationFrame(frame) }
  }, [documentId])
  const active = currentOutlineLine(headings, activeLine)
  const rows = useMemo(() => outlineRows(headings, collapsed, filter), [headings, collapsed, filter])
  const toggle = (line: number) => setCollapsed(current => { const next = new Set(current); if (next.has(line)) next.delete(line); else next.add(line); return next })
  const locate = () => {
    setFilter(''); setCollapsed(new Set())
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-current="location"]')?.scrollIntoView({ block: 'nearest' }))
  }
  return <div className="sidebar-scroll outline-panel" ref={root}>
    <h2 className="sidebar-label">{name}</h2>
    <input className="outline-filter" aria-label="筛选标题" placeholder="筛选标题…" value={filter} onChange={event => setFilter(event.target.value)} />
    <div className="outline-options"><button type="button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(headings.map(item => item.line)))}>{collapsed.size ? '全部展开' : '全部折叠'}</button><label><input type="checkbox" checked={numbered} onChange={event => setNumbered(event.target.checked)} />编号</label><button type="button" className="icon-button" aria-label="定位当前章节" title="定位当前章节" onClick={locate}><LocateFixed size={14} /></button></div>
    {rows.length ? rows.map(({ heading, hasChildren, number }) => <div className="outline-row" key={heading.line} style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}>
      {hasChildren ? <button type="button" className="outline-collapse" aria-label={`${collapsed.has(heading.line) ? '展开' : '折叠'} ${heading.text}`} aria-expanded={!collapsed.has(heading.line)} onClick={() => toggle(heading.line)}>{collapsed.has(heading.line) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button> : <span className="outline-collapse-space" />}
      <button className="outline-item" data-testid="outline-item" aria-current={heading.line === active ? 'location' : undefined} onClick={() => { setActiveLine(heading.line); onJump(heading.line) }} title={heading.text}><span className="outline-marker">{numbered ? number : heading.level}</span>{heading.text}</button>
    </div>) : <p className="empty-hint">{filter ? '没有匹配的标题。' : '用标题组织文章，\n大纲会出现在这里。'}</p>}
  </div>
}
