import { Prec, StateEffect, StateField, type EditorState, type TransactionSpec } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorView, keymap } from '@codemirror/view'
import { markdownOptionsFacet } from './markdown-config'
import { readFrontMatter } from './markdown-features'

interface MarkdownPair { from: number; to: number; delimiter: string }
const changePair = StateEffect.define<{ remove?: MarkdownPair; add?: MarkdownPair }>()
export const markdownPairs = StateField.define<readonly MarkdownPair[]>({
  create: () => [],
  update: (pairs, transaction) => {
    let next = pairs.filter(pair => !transaction.effects.some(effect => effect.is(changePair) && effect.value.remove === pair))
    if (transaction.docChanged) next = next.map(pair => ({ ...pair, from: transaction.changes.mapPos(pair.from, 1), to: transaction.changes.mapPos(pair.to, 1) })).filter(pair => pair.from + pair.delimiter.length <= pair.to
      && transaction.newDoc.sliceString(pair.from, pair.from + pair.delimiter.length) === pair.delimiter
      && transaction.newDoc.sliceString(pair.to, pair.to + pair.delimiter.length) === pair.delimiter)
    for (const effect of transaction.effects) if (effect.is(changePair) && effect.value.add) next.push(effect.value.add)
    return next.slice(-32)
  },
})
const PAIRS = new Set(['*', '_', '~', '=', '^', '$', '`'])

function enabled(state: EditorState, text: string): boolean {
  const options = state.facet(markdownOptionsFacet)
  return options.autoPairMarkdown && PAIRS.has(text) && !(options.strictMode && ['~', '=', '^', '$'].includes(text))
    && !(text === '=' && !options.highlight) && !(text === '^' && !options.superscript) && !(text === '$' && !options.inlineMath)
}

/** Apply only typed characters to exact source ranges; paste/composition use the normal input path. */
export function markdownInputTransaction(state: EditorState, from: number, to: number, text: string): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || text.length !== 1 || !state.facet(markdownOptionsFacet).autoPairMarkdown) return null
  const pairs = state.field(markdownPairs, false) ?? []
  const pair = from === to ? pairs.findLast(value => from >= value.to && from < value.to + value.delimiter.length) : undefined
  if (pair && text === pair.delimiter[0] && enabled(state, text)) {
    const empty = pair.from + pair.delimiter.length === pair.to
    const linePrefix = state.doc.sliceString(state.doc.lineAt(from).from, pair.from)
    // Consecutive openers form bold/strike/code spans. Three backticks remain a normal fence trigger.
    if (empty && from === pair.to && ['*', '_', '~', '`', '$'].includes(text)) {
      const delimiter = pair.delimiter + text
      if ((!linePrefix.trim() && ((text === '`' && delimiter.length === 3) || (text === '$' && delimiter.length === 2) || (text === '*' && delimiter.length === 3)))) {
        return { changes: { from: pair.from, to: pair.to + pair.delimiter.length, insert: delimiter }, selection: { anchor: pair.from + delimiter.length }, effects: changePair.of({ remove: pair }), userEvent: 'input.type' }
      }
      if (pair.delimiter.length === 1) return { changes: { from: pair.from, to: pair.to + 1, insert: delimiter + delimiter }, selection: { anchor: pair.from + 2 }, effects: changePair.of({ remove: pair, add: { from: pair.from, to: pair.from + 2, delimiter } }), userEvent: 'input.type' }
    }
    return { selection: { anchor: from + 1 }, effects: from + 1 === pair.to + pair.delimiter.length ? changePair.of({ remove: pair }) : [], userEvent: 'input.type' }
  }
  // Typing a list marker and space must not leave an automatically inserted trailing asterisk.
  if (pair && text === ' ' && pair.delimiter === '*' && pair.from + 1 === pair.to && !state.doc.sliceString(state.doc.lineAt(from).from, pair.from).trim()) {
    return { changes: { from, to: from + 1, insert: ' ' }, selection: { anchor: from + 1 }, effects: changePair.of({ remove: pair }), userEvent: 'input.type' }
  }
  if (!enabled(state, text)) return null
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, Math.max(from, to) + 1), 50)
  if (!tree) return null
  let node = tree.resolveInner(from, -1)
  for (;;) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'URL', 'Autolink', 'HTMLTag', 'HTMLBlock'].includes(node.name)) return null
    if (!node.parent) break
    node = node.parent
  }
  const options = state.facet(markdownOptionsFacet)
  if (options.frontMatter) {
    const matter = readFrontMatter(state.doc.toString())
    if (matter && state.doc.lineAt(from).number <= matter.endLine) return null
  }
  const prefix = state.doc.sliceString(state.doc.lineAt(from).from, from)
  if ((prefix.match(/\\+$/)?.[0].length ?? 0) % 2 || /(?:https?:\/\/|mailto:)\S*$/.test(prefix)) return null
  const selected = state.doc.sliceString(from, to)
  if (selected) {
    const delimiter = text === '=' ? '==' : text
    return { changes: { from, to, insert: delimiter + selected + delimiter }, selection: { anchor: from + delimiter.length, head: to + delimiter.length }, userEvent: 'input.type' }
  }
  const next = state.doc.sliceString(to, to + 1)
  const previous = state.doc.sliceString(Math.max(0, from - 1), from)
  if (next && !/[\s)\]}.,;:!?]/.test(next)) return null
  if (['*', '_', '$', '`'].includes(text) && /[\p{L}\p{N}_]/u.test(previous)) return null
  let delimiter = text
  let start = from
  if (text === '=') {
    // Leave a single equals sign (ordinary prose/equations) alone; pair the second one.
    if (previous !== '=' || (from > 1 && state.doc.sliceString(from - 2, from - 1) === '=')) return null
    delimiter = '=='
    start--
  }
  return { changes: { from: start, to, insert: delimiter + delimiter }, selection: { anchor: start + delimiter.length }, effects: changePair.of({ add: { from: start, to: start + delimiter.length, delimiter } }), userEvent: 'input.type' }
}

export function markdownPairBackspace(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty || !state.facet(markdownOptionsFacet).autoPairMarkdown) return null
  const from = state.selection.main.head
  const pair = state.field(markdownPairs, false)?.findLast(value => value.to === from && value.from + value.delimiter.length === from)
  if (!pair) return null
  return { changes: { from: pair.from, to: pair.to + pair.delimiter.length }, selection: { anchor: pair.from }, effects: changePair.of({ remove: pair }), userEvent: 'delete.backward' }
}

export const markdownInputExtension = [markdownPairs, Prec.high(EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing) return false
  const transaction = markdownInputTransaction(view.state, from, to, text)
  if (!transaction) return false
  view.dispatch(transaction)
  return true
})), Prec.high(keymap.of([{ key: 'Backspace', run: view => {
  if (view.composing) return false
  const transaction = markdownPairBackspace(view.state)
  if (!transaction) return false
  view.dispatch(transaction)
  return true
} }]))]
