import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { hydratePreview, renderReadingMarkdown } from './markdown'
import { ReadingSearch, type ReadingSearchHandle } from './ReadingSearch'
import { readReadingAnchor, restoreReadingAnchor, type SemanticScrollAnchor } from './semantic-scroll'
import type { EditorCommand, JumpRequest } from './types'
import { primaryShortcut } from '../platform-shortcuts'

interface ReadingViewProps {
  platform: string
  documentId: string
  content: string
  theme: 'light' | 'dark'
  fontSize: number
  command: EditorCommand | null
  jumpToLine: JumpRequest | null
  onLinkOpen: (target: string) => void
  resolveResource: (source: string) => Promise<string>
  initialAnchor: SemanticScrollAnchor | null
}

export interface ReadingViewHandle { getScrollAnchor: () => SemanticScrollAnchor | null }

function selectArticle(article: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(article)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export const ReadingView = forwardRef<ReadingViewHandle, ReadingViewProps>(function ReadingView(props, ref) {
  const articleRef = useRef<HTMLElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const callbackRef = useRef(props)
  const searchRef = useRef<ReadingSearchHandle>(null)
  const commandIdRef = useRef(props.command?.id)
  const jumpIdRef = useRef(props.jumpToLine?.id)
  const laidOutDocumentRef = useRef<string | null>(null)
  const pendingAnchorRef = useRef<SemanticScrollAnchor | null>(props.initialAnchor)
  const initialScrollTopRef = useRef(0)
  const readingMovedRef = useRef(false)
  const automaticAnchorRef = useRef(true)
  const layoutAnchorRef = useRef<SemanticScrollAnchor | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'limit'>('loading')
  callbackRef.current = props

  useImperativeHandle(ref, () => ({ getScrollAnchor: () => {
    const root = rootRef.current
    const moved = readingMovedRef.current || Boolean(root && Math.abs(root.scrollTop - initialScrollTopRef.current) > 1)
    return status === 'ready' && laidOutDocumentRef.current === callbackRef.current.documentId && moved && root && articleRef.current ? readReadingAnchor(root, articleRef.current) : null
  } }), [status])

  useEffect(() => { rootRef.current?.focus({ preventScroll: true }) }, [])

  useLayoutEffect(() => {
    const article = articleRef.current
    if (!article) return
    let canceled = false
    pendingAnchorRef.current = laidOutDocumentRef.current === props.documentId && rootRef.current ? readReadingAnchor(rootRef.current, article) : props.initialAnchor
    if (laidOutDocumentRef.current !== props.documentId) {
      readingMovedRef.current = false
      automaticAnchorRef.current = false
      layoutAnchorRef.current = null
      initialScrollTopRef.current = 0
      if (rootRef.current) rootRef.current.scrollTop = 0
    }
    setStatus('loading')
    article.style.visibility = 'hidden'
    article.replaceChildren()
    if (props.content.length > 200000) {
      setStatus('limit')
      return
    }
    void (async () => {
      try {
        const staging = document.createElement('div')
        staging.innerHTML = renderReadingMarkdown(props.content)
        const sources = new Map<HTMLElement, string>()
        for (const element of staging.querySelectorAll<HTMLElement>('[data-math], [data-mermaid]')) {
          sources.set(element, element.textContent || '')
          element.replaceChildren()
        }
        article.replaceChildren(...Array.from(staging.childNodes))
        await hydratePreview(article, {
          theme: props.theme,
          resolveResource: (source) => callbackRef.current.resolveResource(source),
          sourceText: (element) => sources.get(element) || '',
          errorMode: 'placeholder',
        })
        if (canceled) return
        setStatus('ready')
      } catch {
        if (canceled) return
        article.replaceChildren()
        setStatus('error')
      }
    })()
    return () => { canceled = true }
  }, [props.documentId, props.content, props.theme])

  useLayoutEffect(() => {
    if (status !== 'ready' || !articleRef.current || !rootRef.current) return
    layoutAnchorRef.current = pendingAnchorRef.current
    automaticAnchorRef.current = !readingMovedRef.current
    if (pendingAnchorRef.current) restoreReadingAnchor(rootRef.current, articleRef.current, pendingAnchorRef.current)
    initialScrollTopRef.current = rootRef.current.scrollTop
    pendingAnchorRef.current = null
    laidOutDocumentRef.current = props.documentId
  }, [status])

  useEffect(() => {
    const article = articleRef.current
    const root = rootRef.current
    if (status !== 'ready' || !article || !root) return
    const observer = new ResizeObserver(() => {
      if (!automaticAnchorRef.current || !layoutAnchorRef.current || article.style.visibility !== 'visible' || laidOutDocumentRef.current !== callbackRef.current.documentId) return
      // Lazy images may acquire their intrinsic dimensions after the initial hydration.
      restoreReadingAnchor(root, article, layoutAnchorRef.current)
      initialScrollTopRef.current = root.scrollTop
    })
    observer.observe(article)
    return () => observer.disconnect()
  }, [status])

  useEffect(() => {
    if (status !== 'ready' || !props.jumpToLine || props.jumpToLine.id === jumpIdRef.current || !articleRef.current) return
    jumpIdRef.current = props.jumpToLine.id
    automaticAnchorRef.current = false
    const targets = Array.from(articleRef.current.querySelectorAll<HTMLElement>('[data-source-line]'))
    const target = targets.find((element) => Number(element.dataset.sourceLine) >= props.jumpToLine!.line) || targets.at(-1)
    target?.scrollIntoView({ block: 'center' })
  }, [props.jumpToLine?.id, status])

  useEffect(() => {
    if (props.command?.id === commandIdRef.current) return
    commandIdRef.current = props.command?.id
    if (props.command?.action === 'select-all' && articleRef.current && status === 'ready') selectArticle(articleRef.current)
    if (props.command?.action === 'find') searchRef.current?.open()
  }, [props.command?.id])

  return <div className="reading-view" data-testid="reading-view" data-reading-status={status} aria-busy={status === 'loading'} ref={rootRef} style={{ fontSize: props.fontSize }} tabIndex={0}
    onScroll={() => {
      if (status === 'ready' && rootRef.current && Math.abs(rootRef.current.scrollTop - initialScrollTopRef.current) > 1) {
        readingMovedRef.current = true
        automaticAnchorRef.current = false
      }
    }}
    onWheel={() => { automaticAnchorRef.current = false }}
    onTouchMove={() => { automaticAnchorRef.current = false }}
    onPointerDown={() => { automaticAnchorRef.current = false }}
    onKeyDown={(event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) automaticAnchorRef.current = false
      const isInput = event.target instanceof Element && Boolean(event.target.closest('input,textarea'))
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && articleRef.current && !isInput) { event.preventDefault(); selectArticle(articleRef.current) }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); searchRef.current?.open() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); event.stopPropagation(); searchRef.current?.next(event.shiftKey ? -1 : 1) }
      if (event.key === 'Escape') { event.preventDefault(); searchRef.current?.close() }
    }}
    onClick={(event) => {
      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest('a')
      if (!anchor) return
      event.preventDefault()
      const href = anchor.getAttribute('href')
      if (!href) return
      if (href.startsWith('#')) {
        let id = href.slice(1)
        try { id = decodeURIComponent(id) } catch { /* Invalid fragments remain local inert identifiers. */ }
        const destination = articleRef.current?.querySelector(`[id="${CSS.escape(id)}"]`)
        if (destination) destination.scrollIntoView({ block: 'center' })
        else callbackRef.current.onLinkOpen(href)
      } else callbackRef.current.onLinkOpen(href)
    }}>
    <ReadingSearch ref={searchRef} articleRef={articleRef} ready={status === 'ready'} version={props.content} onClose={() => rootRef.current?.focus({ preventScroll: true })} />
    {status === 'loading' ? <p className="reading-status" role="status">正在排版阅读视图…</p> : null}
    {status === 'limit' ? <p className="reading-status" role="alert">当前阅读模式支持不超过 20 万个字符的文档。请按 {primaryShortcut(props.platform, 'E')} 返回编辑模式查看此文档。</p> : null}
    {status === 'error' ? <p className="reading-status" role="alert">阅读排版失败，请按 {primaryShortcut(props.platform, 'E')} 返回编辑模式检查文档。</p> : null}
    <article ref={articleRef} className="md-preview-block reading-article" aria-label="Markdown 阅读内容" aria-hidden={status !== 'ready'} style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
  </div>
})
