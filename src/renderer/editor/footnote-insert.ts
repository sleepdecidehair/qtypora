import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { Tree } from '@lezer/common'
import { editLiveBlock, liveBlocks } from './live-blocks'
import { markdownOptionsFacet } from './markdown-config'
import { supportsPreview } from './preview-budget'

function isGraphemeBoundary(state: EditorState, position: number): boolean {
  const line = state.doc.lineAt(position)
  if (position === line.to) return true
  const offset = position - line.from
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text)).some(segment => segment.index === offset)
}

function canAppendDefinition(state: EditorState, tree: Tree): boolean {
  if (!state.doc.length) return true
  let node = tree.resolveInner(state.doc.length - 1, 1)
  while (node.parent && node.name !== 'FencedCode' && node.name !== 'HTMLBlock' && node.name !== 'CommentBlock') node = node.parent
  if (node.name === 'FencedCode') return node.getChildren('CodeMark').length >= 2
  if (node.name !== 'HTMLBlock' && node.name !== 'CommentBlock') return true
  const text = state.doc.sliceString(node.from, node.to)
  if (/^\s*<!--/.test(text)) return text.includes('-->')
  if (/^\s*<\?/.test(text)) return text.includes('?>')
  if (/^\s*<!\[CDATA\[/.test(text)) return text.includes(']]>')
  if (/^\s*<![A-Z]/.test(text)) return text.includes('>')
  const tag = text.match(/^\s*<(script|pre|style|textarea)(?:\s|>|$)/i)?.[1]
  return !tag || new RegExp(`</${tag}\\s*>`, 'i').test(text)
}

/** Insert a collision-free reference and editable definition in one undoable change. */
export function insertFootnote(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty || !state.facet(markdownOptionsFacet).footnotes || !supportsPreview(state)) return null
  const position = state.selection.main.head
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || !isGraphemeBoundary(state, position)) return null
  if (liveBlocks(state).some(block => position >= block.from && position <= block.to)) return null
  const line = state.doc.lineAt(position)
  const lookup = line.length ? Math.min(position, line.to - 1) : position
  let node = tree.resolveInner(lookup, 1)
  while (node.parent) {
    if ((node.name === 'Escape' || node.name === 'Entity') && position > node.from && position < node.to) return null
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'Link', 'Image', 'URL', 'Autolink', 'HTMLTag', 'HTMLBlock', 'LinkReference', 'EmphasisMark', 'CodeMark', 'LinkMark', 'HeaderMark', 'QuoteMark', 'ListMark', 'TaskMarker', 'StrikethroughMark'].includes(node.name)) return null
    node = node.parent
  }
  for (const match of line.text.matchAll(/(?<!\\)\$(?!\$)(\S(?:[^$\n]*?\S)?)\$(?!\$)/g)) {
    const start = line.from + match.index, end = start + match[0].length
    if (position > start && position < end) return null
  }
  if (!canAppendDefinition(state, tree)) return null
  const source = state.doc.toString()
  const used = new Set(Array.from(source.matchAll(/\[\^([^\]\s]+)\]/g), match => match[1].toLowerCase()))
  let number = 1
  while (used.has(`fn${number}`)) number++
  const reference = `[^fn${number}]`
  const definition = `[^fn${number}]: `
  const base = source + (position === source.length ? reference : '')
  const separator = base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n'
  const definitionStart = source.length + reference.length + separator.length
  const changes = position === source.length
    ? [{ from: position, insert: reference + separator + definition }]
    : [{ from: position, insert: reference }, { from: source.length, insert: separator + definition }]
  return { changes, selection: { anchor: definitionStart + definition.length }, effects: editLiveBlock.of({ from: definitionStart, to: definitionStart + definition.length }), annotations: isolateHistory.of('full'), userEvent: 'input.insert-footnote', scrollIntoView: true }
}

/** Wrap selected plain text in a reference link and append its definition. */
export function insertReferenceLink(state: EditorState, address: string): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || state.selection.main.empty || !supportsPreview(state)) return null
  const { from, to } = state.selection.main
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || !isGraphemeBoundary(state, from) || !isGraphemeBoundary(state, to) || (from > 0 && state.doc.sliceString(from - 1, from) === '!')) return null
  const label = state.doc.sliceString(from, to)
  const destination = address.trim()
  if (!label || /[\n\r\[\]\\`*_~^$<>]/.test(label) || !destination || /[\s<>\\\x00-\x1f\x7f]/.test(destination) || /^(?:javascript|data|file|vbscript|blob):/i.test(destination) || (/^[a-z][a-z\d+.-]*:/i.test(destination) && !/^(?:https?|mailto):/i.test(destination))) return null
  const first = state.doc.lineAt(from)
  if (state.doc.lineAt(to).number !== first.number) return null
  if (liveBlocks(state).some(block => from < block.to && to > block.from)) return null
  let partialEntity = false
  tree.iterate({ from, to, enter(node) {
    if (node.name === 'Entity' && from < node.to && to > node.from && (from > node.from || to < node.to)) partialEntity = true
  } })
  if (partialEntity) return null
  for (const position of [from, Math.max(from, to - 1)]) {
    let node = tree.resolveInner(position, 1)
    while (node.parent) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'Link', 'Image', 'URL', 'Autolink', 'HTMLTag', 'HTMLBlock', 'LinkReference', 'EmphasisMark', 'CodeMark', 'LinkMark', 'HeaderMark', 'QuoteMark', 'ListMark', 'TaskMarker', 'StrikethroughMark'].includes(node.name)) return null
      node = node.parent
    }
  }
  for (const match of first.text.matchAll(/(?<!\\)\$(?!\$)(\S(?:[^$\n]*?\S)?)\$(?!\$)/g)) {
    const start = first.from + match.index, end = start + match[0].length
    if (from < end && to > start) return null
  }
  const source = state.doc.toString()
  if (!canAppendDefinition(state, tree)) return null
  const used = new Set(Array.from(source.matchAll(/\[([^\]\n]+)\]/g), match => match[1].trim().toLowerCase()))
  let number = 1
  while (used.has(`ref${number}`)) number++
  const wrapped = `[${label}][ref${number}]`
  const definition = `[ref${number}]: <${destination}>`
  const sourceEnd = to === source.length ? source.slice(0, from) + wrapped : source
  const separator = sourceEnd.endsWith('\n\n') ? '' : sourceEnd.endsWith('\n') ? '\n' : '\n\n'
  const changes = to === source.length
    ? [{ from, to, insert: wrapped + separator + definition }]
    : [{ from, to, insert: wrapped }, { from: source.length, insert: separator + definition }]
  return { changes, selection: { anchor: from + 1, head: from + 1 + label.length }, annotations: isolateHistory.of('full'), userEvent: 'input.insert-reference-link', scrollIntoView: true }
}
