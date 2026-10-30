import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { editLiveBlock, liveBlocks } from './live-blocks'
import { markdownOptionsFacet } from './markdown-config'
import { supportsPreview } from './preview-budget'
import { canFormatSemanticLines } from './semantic-format-guard'
import { getMarkdownParser } from './markdown-parser'

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

function staysPlainParagraph(state: EditorState, text: string): boolean {
  if (!text) return true
  if (!text.trim() || text.length > 20_000) return false
  try {
    const tokens = getMarkdownParser(state.facet(markdownOptionsFacet)).parse(text, {})
    return tokens.length === 3 && tokens[0].type === 'paragraph_open' && tokens[1].type === 'inline' && tokens[2].type === 'paragraph_close'
      && (tokens[1].children ?? []).every(token => token.type === 'text')
      && (tokens[1].children ?? []).map(token => token.content).join('') === text.trim()
  } catch { return false }
}

/** Insert an alert only on an independently parsed, top-level empty line. */
export function insertAlert(state: EditorState, kind: AlertKind): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.facet(markdownOptionsFacet).alerts || !supportsPreview(state)) return null
  if (!['note', 'tip', 'important', 'warning', 'caution'].includes(kind)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return null
  const selection = state.selection.main
  const alert = liveBlocks(state).find(block => block.kind === 'alert' && selection.from >= block.from && selection.to <= block.to)
  if (alert) {
    const lines = alert.source.split('\n')
    const marker = /^( {0,3}>[ \t]?)(\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])[ \t]*$/.exec(lines[0])
    if (!marker || lines.length < 2 || selection.from < alert.from + lines[0].length + 1) return null
    if (lines.slice(1).some(line => !/^ {0,3}>/.test(line) || /^ {0,3}>[ \t]*>/.test(line))) return null
    if (marker[3].toLowerCase() === kind && !lines.slice(1).some(line => line.replace(/^ {0,3}>[ \t]?/, '').trim())) {
      if (lines.length !== 2 || lines[1] !== '> ' || marker[1] !== '> ' || lines[0] !== `> ${marker[2]}` || !selection.empty) return null
    }
    if (/^ {0,3}>[ \t]?\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.test(lines[1])) return null
    const change = marker[3].toLowerCase() === kind
      ? { from: alert.from, to: alert.from + lines[0].length + 1, insert: '' }
      : { from: alert.from + marker[1].length, to: alert.from + marker[1].length + marker[2].length, insert: `[!${kind.toUpperCase()}]` }
    return { changes: change, annotations: isolateHistory.of('full'), userEvent: 'input.toggle-alert', scrollIntoView: true }
  }
  if (!selection.empty) return null
  const line = state.doc.lineAt(state.selection.main.head)
  if (!canFormatSemanticLines(state, line.from, line.to)) return null
  if (state.doc.line(1).text === '---') {
    let closing = 0
    for (let number = 2; number <= state.doc.lines; number++) {
      if (/^(?:---|\.\.\.)\s*$/.test(state.doc.line(number).text)) { closing = number; break }
    }
    if (!closing || line.number <= closing) return null
  }
  if (line.text.trim()) {
    const position = selection.head
    if (/[\\`*_~^$<>!>|+{}&\[\]]|\d+\)| {4}|\t/.test(line.text)) return null
    if (position !== line.to && !Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text)).some(segment => segment.index === position - line.from)) return null
    let node = tree.resolveInner(Math.min(position, line.to - 1), 1)
    while (node.parent && node.name !== 'Paragraph') node = node.parent
    if (node.name !== 'Paragraph' || node.parent?.name !== 'Document' || node.from !== line.from || node.to !== line.to || node.firstChild) return null
    if (liveBlocks(state).some(block => position >= block.from && position <= block.to)) return null
    if (!staysPlainParagraph(state, line.text) || !staysPlainParagraph(state, line.text.slice(0, position - line.from)) || !staysPlainParagraph(state, line.text.slice(position - line.from))) return null
    const before = position > line.from ? '\n\n' : line.number > 1 && state.doc.line(line.number - 1).text.trim() ? '\n' : ''
    const after = position < line.to ? '\n\n' : line.number < state.doc.lines && state.doc.line(line.number + 1).text.trim() ? '\n' : ''
    const block = `> [!${kind.toUpperCase()}]\n> `
    const from = position + before.length
    return { changes: { from: position, insert: before + block + after }, selection: { anchor: from + block.length }, effects: editLiveBlock.of({ from, to: from + block.length }), annotations: isolateHistory.of('full'), userEvent: 'input.insert-alert', scrollIntoView: true }
  }
  if (liveBlocks(state).some(block => line.from >= block.from && line.from <= block.to)) return null
  let unsafe = false
  tree.iterate({ from: line.from, to: Math.min(state.doc.length, line.to + 1), enter(node) {
    if (node.from <= line.from && node.to >= line.from && ['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'ListItem', 'Blockquote'].includes(node.name)) { unsafe = true; return false }
  } })
  if (unsafe) return null
  const prefix = line.number > 1 && state.doc.line(line.number - 1).text.trim() ? '\n' : ''
  const block = `> [!${kind.toUpperCase()}]\n> `
  const from = line.from + prefix.length
  return { changes: { from: line.from, insert: prefix + block + '\n' }, selection: { anchor: from + block.length }, effects: editLiveBlock.of({ from, to: from + block.length }), annotations: isolateHistory.of('full'), userEvent: 'input.insert-alert', scrollIntoView: true }
}
