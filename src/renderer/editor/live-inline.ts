import type { EditorState } from '@codemirror/state'
import { markdownOptionsFacet, markdownDocumentModel } from './markdown-config'
import type { FootnoteEnvironment } from './markdown-references'
import { getMarkdownParser } from './markdown-parser'
import { syntaxTree } from '@codemirror/language'

export interface InlinePreviewSpan { from: number; to: number; className?: string; hidden?: boolean; line?: boolean; href?: string; replacement?: string }
const INLINE_CLASSES: Record<string, string> = { StrongEmphasis: 'cm-live-strong', Emphasis: 'cm-live-emphasis', Strikethrough: 'cm-live-strike', InlineCode: 'cm-live-code', Link: 'cm-live-link' }
const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark'])

export function inlinePreviewSpans(state: EditorState, excluded: readonly { from: number; to: number }[] = []): InlinePreviewSpan[] {
  const spans: InlinePreviewSpan[] = []
  const selection = state.selection.main
  const settings = state.facet(markdownOptionsFacet)
  const model = markdownDocumentModel(state)
  syntaxTree(state).iterate({ enter: (node) => {
    if (excluded.some((range) => node.from >= range.from && node.to <= range.to)) return false
    if (settings.strictMode && node.name === 'Strikethrough') return false
    const className = INLINE_CLASSES[node.name]
    if (className) {
      const active = selection.empty && selection.head > node.from && selection.head < node.to
      const url = node.name === 'Link' ? node.node.getChild('URL') : null
      const referenceHref = node.name === 'Link' && !url ? model.parser.parseInline(state.doc.sliceString(node.from, node.to), { references: model.environment.references })[0]?.children?.find(token => token.type === 'link_open')?.attrGet('href') : null
      spans.push({ from: node.from, to: node.to, className, ...(url ? { href: state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, '') } : referenceHref ? { href: referenceHref } : {}) })
      if (!active) {
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (INLINE_MARKS.has(child.name) || (node.name === 'Link' && (child.name === 'URL' || child.name === 'LinkTitle' || child.name === 'LinkLabel'))) spans.push({ from: child.from, to: child.to, hidden: true })
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
  const blocked = (from: number, to: number): boolean => {
    if (excluded.some(range => from < range.to && to > range.from)) return true
    if (from > 0 && state.doc.sliceString(from - 1, from) === '\\') return true
    let node = syntaxTree(state).resolveInner(from, 1)
    for (;;) {
      if (['InlineCode', 'FencedCode', 'CodeBlock', 'URL', 'Autolink', 'HTMLTag', 'HTMLBlock', 'Image'].includes(node.name)) return true
      if (!node.parent) break
      node = node.parent
    }
    return false
  }
  const active = (from: number, to: number): boolean => selection.empty && selection.head > from && selection.head < to
  const patterns: { enabled: boolean; expression: RegExp; marker: number; className: string }[] = [
    { enabled: settings.highlight, expression: /==(?=\S)([^=\n]+?)==/g, marker: 2, className: 'cm-live-highlight' },
    { enabled: settings.subscript, expression: /(?<!~)~([^~\s]+)~(?!~)/g, marker: 1, className: 'cm-live-subscript' },
    { enabled: settings.superscript, expression: /\^([^\^\s]+)\^/g, marker: 1, className: 'cm-live-superscript' },
  ]
  const parser = getMarkdownParser(settings)
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    for (const pattern of patterns) {
      if (!pattern.enabled) continue
      for (const match of line.text.matchAll(pattern.expression)) {
        const from = line.from + match.index
        const to = from + match[0].length
        if (blocked(from, to)) continue
        spans.push({ from, to, className: pattern.className })
        if (!active(from, to)) spans.push({ from, to: from + pattern.marker, hidden: true }, { from: to - pattern.marker, to, hidden: true })
      }
    }
    if (settings.footnotes) for (const match of line.text.matchAll(/\[\^([^\]\s]+)\]/g)) {
      const from = line.from + match.index
      const to = from + match[0].length
      const id = (model.environment.footnotes as FootnoteEnvironment | undefined)?.refs?.[`:${match[1]}`]
      if (id === undefined || id < 0 || blocked(from, to) || active(from, to) || (match.index <= 3 && line.text[match.index + match[0].length] === ':')) continue
      spans.push({ from, to, replacement: `[${id + 1}]`, href: `#fn${id + 1}` })
    }
    if (settings.emoji) for (const match of line.text.matchAll(/:[a-zA-Z0-9_+-]+:/g)) {
      const from = line.from + match.index
      const to = from + match[0].length
      if (blocked(from, to) || active(from, to)) continue
      const token = parser.parseInline(match[0], {})[0]?.children?.[0]
      if (token?.type === 'emoji') spans.push({ from, to, replacement: token.content })
    }
    if (settings.smartPunctuation) for (const match of line.text.matchAll(/\.{3}|---?|(\")([^\"]+)(\")|'([^']+)'/g)) {
      const from = line.from + match.index
      const to = from + match[0].length
      if (blocked(from, to) || active(from, to)) continue
      const tokens = parser.parseInline(match[0], {})[0]?.children
      if (tokens?.every(token => token.type === 'text')) {
        const replacement = tokens.map(token => token.content).join('')
        if (replacement !== match[0]) spans.push({ from, to, replacement })
      }
    }
  }
  return spans
}

export function styleScope(state: EditorState): { from: number; to: number } {
  const selection = state.selection.main
  let node = syntaxTree(state).resolveInner(selection.head, -1)
  for (; node.parent; node = node.parent) {
    if (state.facet(markdownOptionsFacet).strictMode && node.name === 'Strikethrough') continue
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
