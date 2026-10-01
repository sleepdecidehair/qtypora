import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

export interface InlinePreviewSpan { from: number; to: number; className?: string; hidden?: boolean; line?: boolean; href?: string }
const INLINE_CLASSES: Record<string, string> = { StrongEmphasis: 'cm-live-strong', Emphasis: 'cm-live-emphasis', Strikethrough: 'cm-live-strike', InlineCode: 'cm-live-code', Link: 'cm-live-link' }
const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark'])

export function inlinePreviewSpans(state: EditorState, excluded: readonly { from: number; to: number }[] = []): InlinePreviewSpan[] {
  const spans: InlinePreviewSpan[] = []
  const selection = state.selection.main
  syntaxTree(state).iterate({ enter: (node) => {
    if (excluded.some((range) => node.from >= range.from && node.to <= range.to)) return false
    const className = INLINE_CLASSES[node.name]
    if (className) {
      const active = selection.empty ? selection.head > node.from && selection.head < node.to : selection.from < node.to && selection.to > node.from
      const url = node.name === 'Link' ? node.node.getChild('URL') : null
      spans.push({ from: node.from, to: node.to, className, ...(url ? { href: state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, '') } : {}) })
      if (!active) {
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (INLINE_MARKS.has(child.name) || (node.name === 'Link' && (child.name === 'URL' || child.name === 'LinkTitle'))) spans.push({ from: child.from, to: child.to, hidden: true })
        }
      }
    }
    if (/^(?:ATX|Setext)Heading\d$/.test(node.name)) {
      const openingMark = node.node.getChild('HeaderMark')
      // A bare # is a valid parsed empty heading, but typing it must stay visible until a separator is entered.
      if (node.name.startsWith('ATX') && (!openingMark || !/^[ \t]/.test(state.doc.sliceString(openingMark.to, openingMark.to + 1)))) return
      const level = node.name.match(/\d$/)![0]
      spans.push({ from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.from).from, line: true, className: `cm-live-heading cm-live-heading-${level}` })
      for (let child = node.node.firstChild; child; child = child.nextSibling) if (child.name === 'HeaderMark') {
        let to = child.to
        if (child.from === node.from && state.doc.sliceString(to, to + 1) === ' ') to++
        spans.push({ from: child.from, to, hidden: true })
      }
    }
    if (node.name === 'QuoteMark') {
      spans.push({ from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.from).from, line: true, className: 'cm-live-quote' })
      spans.push({ from: node.from, to: node.to + (state.doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0), hidden: true })
    }
  } })
  return spans
}

export function styleScope(state: EditorState): { from: number; to: number } {
  const selection = state.selection.main
  let node = syntaxTree(state).resolveInner(selection.head, -1)
  for (; node.parent; node = node.parent) {
    if (!INLINE_CLASSES[node.name] || node.from > selection.from || node.to < selection.to) continue
    const first = node.firstChild
    const last = node.lastChild
    const from = first && INLINE_MARKS.has(first.name) ? first.to : node.from
    const to = node.name === 'Link' ? (node.getChildren('LinkMark')[1]?.from ?? node.to) : last && INLINE_MARKS.has(last.name) ? last.from : node.to
    if (from <= selection.from && to >= selection.to && (from !== selection.from || to !== selection.to)) return { from, to }
  }
  const line = state.doc.lineAt(selection.head)
  const prefix = line.text.match(/^\s{0,3}#{1,6}\s+/)?.[0].length || 0
  return { from: line.from + prefix, to: line.to }
}
