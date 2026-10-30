import { useTranslation } from '../i18n/locale'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, LocateFixed, X } from 'lucide-react'
import type { OutlineHeading } from '../hooks/outline'
import { currentOutlineLine, outlineAncestors, outlineMatchRange, outlineRows } from '../hooks/outlineDisplay'
import { readReadingAnchor } from '../editor/semantic-scroll'

interface OutlinePanelProps { headings: OutlineHeading[]; name: string; documentId?: string; currentLine?: number; flat: boolean; onFlatChange: (flat: boolean) => void; onJump: (line: number) => void }

export function OutlinePanel({ headings, name, documentId, currentLine = 1, flat, onFlatChange, onJump }: OutlinePanelProps) {
  const t = useTranslation()
  const [filter, setFilter] = useState('')
  const [filterShown, setFilterShown] = useState(true)
  const [keyboardLine, setKeyboardLine] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(new Set<number>())
  const [numbered, setNumbered] = useState(false)
  const [activeLine, setActiveLine] = useState(currentLine)
  const root = useRef<HTMLDivElement>(null)
  const filterInput = useRef<HTMLInputElement>(null)
  const focusFilter = useRef(false)
  const pendingLocate = useRef(false)
  const menuRequest = useRef(0)
  const currentDocument = useRef(documentId)
  if (currentDocument.current !== documentId) { currentDocument.current = documentId; menuRequest.current++ }
  useEffect(() => () => { menuRequest.current++ }, [])
  useLayoutEffect(() => { if (filterShown && focusFilter.current) { focusFilter.current = false; filterInput.current?.focus({ preventScroll: true }) } }, [filterShown])
  useLayoutEffect(() => { if (pendingLocate.current) { pendingLocate.current = false; root.current?.querySelector<HTMLElement>('[aria-current="location"]')?.scrollIntoView({ block: 'nearest' }) } }, [collapsed, filter, activeLine])
  useLayoutEffect(() => { if (keyboardLine !== null) root.current?.querySelector<HTMLElement>('[data-outline-keyboard="true"]')?.scrollIntoView({ block: 'nearest' }) }, [keyboardLine])
  useEffect(() => { setActiveLine(currentLine) }, [currentLine])
  useEffect(() => { setCollapsed(new Set()); setFilter(''); setKeyboardLine(null) }, [documentId])
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
  const rows = useMemo(() => outlineRows(headings, collapsed, filter, flat), [headings, collapsed, filter, flat])
  const parentLines = useMemo(() => headings.filter((heading, index) => (headings[index + 1]?.level ?? 0) > heading.level).map(heading => heading.line), [headings])
  const allCollapsed = parentLines.length > 0 && parentLines.every(line => collapsed.has(line))
  const toggle = (line: number) => setCollapsed(current => { const next = new Set(current); if (next.has(line)) next.delete(line); else next.add(line); return next })
  const locate = () => {
    pendingLocate.current = true
    setFilter(''); setCollapsed(current => { const next = new Set(current); for (const line of outlineAncestors(headings, active)) next.delete(line); return next })
  }
  const closeFilter = () => { setFilter(''); setKeyboardLine(null); setFilterShown(false); root.current?.focus({ preventScroll: true }) }
  const jumpHeading = (line: number) => {
    if (!flat) setCollapsed(current => { const next = new Set(current); next.delete(line); return next })
    setActiveLine(line)
    onJump(line)
  }
  const handleFilterKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFilter(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!rows.length) return
      const current = rows.findIndex(row => row.heading.line === keyboardLine)
      const activeIndex = rows.findIndex(row => row.heading.line === active)
      const next = current < 0 ? Math.max(activeIndex, 0) : Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
      setKeyboardLine(rows[next].heading.line)
    } else if (event.key === 'Enter' && keyboardLine !== null && rows.some(row => row.heading.line === keyboardLine)) {
      event.preventDefault()
      jumpHeading(keyboardLine)
      requestAnimationFrame(() => filterInput.current?.focus({ preventScroll: true }))
    }
  }
  const openOutlineMenu = async () => {
    const request = ++menuRequest.current
    const initialDocument = documentId
    const result = await window.desktop.showContextMenu({ kind: 'outline', readOnly: true, hasSelection: false, availableActions: ['outline-locate', 'outline-filter', ...(!flat ? ['outline-expand-all', 'outline-collapse-all'] as const : []), 'outline-collapsible', 'outline-flat'], outlineFlat: flat, outlineFilter: filterShown }).catch(() => null)
    if (request !== menuRequest.current || currentDocument.current !== initialDocument || !result?.ok) return
    if (result.data === 'outline-locate') locate()
    else if (result.data === 'outline-filter') {
      if (filterShown) closeFilter()
      else { focusFilter.current = true; setFilterShown(true) }
    } else if (result.data === 'outline-expand-all' && !flat) setCollapsed(new Set())
    else if (result.data === 'outline-collapse-all' && !flat) setCollapsed(new Set(parentLines))
    else if (result.data === 'outline-flat') onFlatChange(true)
    else if (result.data === 'outline-collapsible') onFlatChange(false)
  }
  return <div className="sidebar-scroll outline-panel" ref={root} tabIndex={-1} onContextMenu={event => { if ((event.target as HTMLElement).closest('input')) return; event.preventDefault(); void openOutlineMenu() }}>
    <h2 className="sidebar-label">{name}</h2>
    {filterShown ? <div className="outline-filter-wrap"><input ref={filterInput} className="outline-filter" aria-label={t('筛选标题')} placeholder={t('筛选标题…')} value={filter} onChange={event => { setFilter(event.target.value); setKeyboardLine(null) }} onKeyDown={handleFilterKey} /><button type="button" className="outline-filter-close" aria-label={t('关闭大纲筛选')} title={t('关闭大纲筛选')} onClick={closeFilter}><X size={13} /></button></div> : null}
    <span className="outline-selection-status" role="status" aria-live="polite">{rows.find(row => row.heading.line === keyboardLine)?.heading.text ?? ''}</span>
    <div className="outline-options"><button type="button" disabled={flat} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parentLines))}>{allCollapsed ? t('全部展开') : t('全部折叠')}</button><label><input type="checkbox" checked={numbered} onChange={event => setNumbered(event.target.checked)} />{t('编号')}</label><button type="button" className="icon-button" aria-label={t('定位当前章节')} title={t('定位当前章节')} onClick={locate}><LocateFixed size={14} /></button></div>
    {rows.length ? rows.map(({ heading, hasChildren, number }) => { const match = outlineMatchRange(heading.text, filter); return <div className="outline-row" key={heading.line} style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}>
      {!flat && hasChildren ? <button type="button" className="outline-collapse" aria-label={`${collapsed.has(heading.line) ? t('展开') : t('折叠')} ${heading.text}`} aria-expanded={!collapsed.has(heading.line)} onClick={() => toggle(heading.line)}>{collapsed.has(heading.line) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button> : <span className="outline-collapse-space" />}
      <button className="outline-item" data-testid="outline-item" data-outline-keyboard={keyboardLine === heading.line ? 'true' : undefined} aria-current={heading.line === active ? 'location' : undefined} onClick={() => jumpHeading(heading.line)} title={heading.text}><span className="outline-marker">{numbered ? number : heading.level}</span>{match ? <>{heading.text.slice(0, match.from)}<mark>{heading.text.slice(match.from, match.to)}</mark>{heading.text.slice(match.to)}</> : heading.text}</button>
    </div> }) : <p className="empty-hint">{filter ? t('没有匹配的标题。') : t('用标题组织文章，\n大纲会出现在这里。')}</p>}
  </div>
}
