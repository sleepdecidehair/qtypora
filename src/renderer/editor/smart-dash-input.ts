import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { getMarkdownParser } from './markdown-parser'
import { markdownOptionsFacet } from './markdown-config'
import { canFormatSemanticLines } from './semantic-format-guard'
import { EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'

/** Only unambiguous single-character typing in a complete top-level plain paragraph. */
export function smartDashInput(state: EditorState, from: number, to: number, text: string, enabled: boolean): TransactionSpec | null {
  if (!enabled || state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty || from !== to || state.selection.main.head !== from || !['-', '.'].includes(text)) return null
  const line = state.doc.lineAt(from)
  if (line.length > 20_000 || !canFormatSemanticLines(state, line.from, line.to)) return null
  if (state.doc.line(1).text === '---') {
    let end = 0
    for (let number = 2; number <= state.doc.lines; number++) if (/^(?:---|\.\.\.)\s*$/.test(state.doc.line(number).text)) { end = number; break }
    if (!end || line.number <= end) return null
  }
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return null
  let node = tree.resolveInner(Math.min(from, Math.max(line.from, line.to - 1)), 1)
  while (node.parent && node.name !== 'Paragraph') node = node.parent
  if (node.name !== 'Paragraph' || node.parent?.name !== 'Document' || node.from !== line.from || node.to !== line.to || node.firstChild) return null
  const prefix = state.doc.sliceString(line.from, from)
  if (/\\$/.test(prefix)) return null
  let count = 0, insert = ''
  if (text === '-' && prefix.endsWith('–')) { count = 1; insert = '—' }
  else if (text === '-' && prefix.endsWith('--')) { count = 2; insert = '—' }
  else if (text === '-' && prefix.endsWith('-')) { count = 1; insert = '–' }
  else if (text === '.' && prefix.endsWith('..')) { count = 2; insert = '…' }
  if (!count || !prefix.slice(0, -count).trim()) return null
  try {
    const tokens = getMarkdownParser(state.facet(markdownOptionsFacet)).parse(line.text, {})
    if (tokens.length !== 3 || tokens[0].type !== 'paragraph_open' || tokens[1].type !== 'inline' || tokens[2].type !== 'paragraph_close' || (tokens[1].children ?? []).some(token => token.type !== 'text')) return null
  } catch { return null }
  return { changes: { from: from - count, to, insert }, selection: { anchor: from - count + insert.length }, annotations: isolateHistory.of('full'), userEvent: 'input.type' }
}

export const smartDashInputExtension = Prec.highest(EditorView.domEventHandlers({
  beforeinput(event, view) {
    if (event.inputType !== 'insertText' || event.isComposing || view.composing || view.compositionStarted || event.target !== view.contentDOM || view.contentDOM.ownerDocument.activeElement !== view.contentDOM || view.contentDOM.dataset.mode !== 'hybrid') return false
    const { from, to } = view.state.selection.main
    const edit = smartDashInput(view.state, from, to, event.data ?? '', view.state.facet(markdownOptionsFacet).smartDashInput)
    if (!edit) return false
    event.preventDefault()
    view.dispatch(edit)
    return true
  },
}))
