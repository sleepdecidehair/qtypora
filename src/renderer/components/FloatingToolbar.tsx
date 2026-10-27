import { useTranslation } from '../i18n/locale'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { EditorView } from '@codemirror/view'
import { Bold, Italic, Strikethrough, Code, Link, Eraser } from 'lucide-react'
import type { EditorAction, EditorSelection } from '../editor/types'

interface FloatingToolbarProps {
  enabled: boolean
  documentId: string
  selection: EditorSelection
  readOnly: boolean
  onAction: (action: EditorAction) => void
}

const actions = [
  ['bold', '加粗', Bold], ['italic', '斜体', Italic], ['strike', '删除线', Strikethrough],
  ['inline-code', '行内代码', Code], ['link', '链接', Link], ['clear-format', '清除格式', Eraser],
] as const

/** Place as a direct child of the editor area; the marker scopes all DOM lookups. */
export function FloatingToolbar({ enabled, documentId, selection, readOnly, onAction }: FloatingToolbarProps) {
  const t = useTranslation()
  const marker = useRef<HTMLSpanElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const dismissed = useRef('')
  const selectionKey = `${documentId}:${selection.from}:${selection.to}:${selection.text}`
  useEffect(() => {
    const area = marker.current?.parentElement
    setPosition(null)
    if (!area || !enabled || readOnly || selection.from === selection.to || !selection.text) return
    let frame: number | null = null
    const measure = () => {
      frame = null
      if (dismissed.current === selectionKey) return
      const editor = area.querySelector<HTMLElement>('.cm-editor')
      const view = editor && EditorView.findFromDOM(editor)
      if (!view || (!view.hasFocus && !toolbar.current?.contains(document.activeElement))) { setPosition(null); return }
      const range = view.state.selection.main
      if (range.from !== selection.from || range.to !== selection.to || view.state.doc.sliceString(range.from, range.to) !== selection.text || view.state.readOnly) { setPosition(null); return }
      const start = view.coordsAtPos(range.from), end = view.coordsAtPos(range.to)
      const viewport = view.scrollDOM.getBoundingClientRect()
      if (!start || !end || end.bottom < viewport.top || start.top > viewport.bottom || start.left > viewport.right || end.right < viewport.left) { setPosition(null); return }
      const width = toolbar.current?.offsetWidth || 216, height = toolbar.current?.offsetHeight || 38
      const topEdge = Math.max(8, viewport.top), bottomEdge = Math.min(window.innerHeight - 8, viewport.bottom)
      const above = start.top - height - 8
      const top = above >= topEdge ? above : Math.max(topEdge, Math.min(bottomEdge - height, end.bottom + 8))
      const anchor = start.top === end.top ? (start.left + end.right) / 2 : start.left
      const left = Math.max(Math.max(8, viewport.left), Math.min(anchor - width / 2, Math.min(window.innerWidth - 8, viewport.right) - width))
      setPosition({ left, top })
    }
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure) }
    const dismiss = () => setPosition(null)
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !area.contains(event.target)) dismiss() }
    area.addEventListener('scroll', schedule, { passive: true, capture: true })
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', schedule)
    window.addEventListener('blur', dismiss)
    const observer = new ResizeObserver(schedule)
    observer.observe(area)
    schedule()
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
      area.removeEventListener('scroll', schedule, true)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('blur', dismiss)
    }
  }, [enabled, documentId, selection.from, selection.to, selection.text, selectionKey, readOnly])
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { dismissed.current = selectionKey; setPosition(null); event.preventDefault(); return }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(toolbar.current?.querySelectorAll('button') ?? [])
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length
    buttons[index]?.focus(); event.preventDefault()
  }
  return <><span hidden ref={marker} />{position ? <div ref={toolbar} className="floating-format-toolbar" role="toolbar" aria-label={t('选区格式工具栏')} data-testid="floating-toolbar" style={position} onPointerDown={event => { if (event.button === 0) event.preventDefault() }} onKeyDown={keyboard}>
    {actions.map(([action, label, Icon]) => <button type="button" className="icon-button" key={action} aria-label={t(label)} title={t(label)} onClick={() => onAction(action)}><Icon size={16} /></button>)}
  </div> : null}</>
}
