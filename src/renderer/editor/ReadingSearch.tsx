import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react'
import { findTextMatches, indexArticleText, matchRange, type ArticleTextIndex } from './reading-search'
import { useLocale } from '../i18n/locale'
import { editorText } from './editor-i18n'

interface ReadingSearchProps {
  articleRef: RefObject<HTMLElement | null>
  ready: boolean
  version: string
  onClose: () => void
}

export interface ReadingSearchHandle {
  open: () => void
  close: () => void
  next: (direction: 1 | -1) => void
}

const EMPTY_INDEX: ArticleTextIndex = { text: '', nodes: [] }

export const ReadingSearch = forwardRef<ReadingSearchHandle, ReadingSearchProps>(function ReadingSearch(props, ref) {
  const locale = useLocale()
  const t = (source: string, values?: Record<string, string | number>) => editorText(locale, source, values)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [index, setIndex] = useState<ArticleTextIndex>(EMPTY_INDEX)
  const inputRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => findTextMatches(index.text, query, caseSensitive), [index.text, query, caseSensitive])

  function open(): void {
    const selected = window.getSelection()
    if (selected?.anchorNode && props.articleRef.current?.contains(selected.anchorNode)) {
      const selectedText = selected.toString()
      if (selectedText && selectedText.length <= 1024) { setQuery(selectedText); setActiveIndex(0) }
    }
    setIsOpen(true)
    inputRef.current?.focus()
    inputRef.current?.select()
  }

  function close(): void { setIsOpen(false); props.onClose() }
  function next(direction: 1 | -1): void {
    if (!isOpen) { open(); return }
    if (matches.length) setActiveIndex((current) => (current + direction + matches.length) % matches.length)
  }

  useImperativeHandle(ref, () => ({ open, close, next }))

  useEffect(() => {
    if (!isOpen || !props.ready || !props.articleRef.current) { setIndex(EMPTY_INDEX); return }
    setIndex(indexArticleText(props.articleRef.current))
    setActiveIndex(0)
  }, [isOpen, props.ready, props.version])

  useEffect(() => { if (isOpen) { inputRef.current?.focus(); inputRef.current?.select() } }, [isOpen])

  useEffect(() => {
    if (!isOpen || !props.ready || !matches.length) return
    const range = matchRange(index, matches[Math.min(activeIndex, matches.length - 1)])
    if (!range) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const viewport = props.articleRef.current?.closest<HTMLElement>('.reading-view')
    if (viewport) {
      const rectangle = range.getBoundingClientRect()
      const viewRectangle = viewport.getBoundingClientRect()
      viewport.scrollTop += rectangle.top - viewRectangle.top - viewport.clientHeight / 2
    }
  }, [isOpen, props.ready, index, matches, activeIndex])

  if (!isOpen) return null
  return <div className="reading-search" role="search" aria-label={t('阅读正文查找')} data-testid="reader-find">
    <input ref={inputRef} type="text" aria-label={t('阅读查找文本')} data-testid="reader-find-input" placeholder={t('普通文本（不支持正则）')} maxLength={1024} value={query}
      onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); next(event.shiftKey ? -1 : 1) }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      }} />
    <span className="reading-search-count" aria-live="polite" data-testid="reader-find-count">{query ? t('{current} / {total} 处', { current: matches.length ? Math.min(activeIndex + 1, matches.length) : 0, total: matches.length }) : t('输入查找内容')}</span>
    <button type="button" aria-label={t('上一处')} title={t('上一处 · Shift+Enter')} data-testid="reader-find-previous" disabled={!props.ready || !matches.length} onClick={() => next(-1)}>{t('上一处')}</button>
    <button type="button" aria-label={t('下一处')} title={t('下一处 · Enter')} data-testid="reader-find-next" disabled={!props.ready || !matches.length} onClick={() => next(1)}>{t('下一处')}</button>
    <label><input type="checkbox" checked={caseSensitive} onChange={(event) => { setCaseSensitive(event.target.checked); setActiveIndex(0) }} />{t('区分大小写')}</label>
    <button type="button" aria-label={t('关闭阅读查找')} title={t('关闭 · Esc')} data-testid="reader-find-close" onClick={close}>{t('关闭')}</button>
  </div>
})
