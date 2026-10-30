import { syntaxTree } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'

/** Change only a parsed heading's delimiters; never reconstruct the document. */
export function headingLevelEdit(state: EditorState, direction: 'promote' | 'demote'): TransactionSpec | null {
  const position = state.selection.main.head
  let heading = syntaxTree(state).resolveInner(position, 1)
  while (heading.parent && !/^(?:ATX|Setext)Heading[1-6]$/.test(heading.name)) heading = heading.parent
  if (!/^(?:ATX|Setext)Heading[1-6]$/.test(heading.name)) {
    heading = syntaxTree(state).resolveInner(position, -1)
    while (heading.parent && !/^(?:ATX|Setext)Heading[1-6]$/.test(heading.name)) heading = heading.parent
  }
  if (!/^(?:ATX|Setext)Heading[1-6]$/.test(heading.name)) return null
  const current = Number(heading.name.slice(-1))
  const target = current + (direction === 'promote' ? -1 : 1)
  if (target < 1 || target > 6) return null
  const first = state.doc.lineAt(heading.from)
  if (heading.name.startsWith('ATX')) {
    const marker = heading.getChild('HeaderMark')
    if (!marker || marker.from !== heading.from) return null
    return { changes: { from: marker.from, to: marker.to, insert: '#'.repeat(target) }, userEvent: 'input.heading-level' }
  }
  const last = state.doc.lineAt(heading.to)
  // Multi-line Setext titles cannot become ATX without changing their meaning.
  if (last.number !== first.number + 1) return null
  if (target <= 2) {
    const underline = heading.getChild('HeaderMark')
    if (!underline || state.doc.lineAt(underline.from).number !== last.number) return null
    return { changes: { from: underline.from, to: underline.to, insert: (target === 1 ? '=' : '-').repeat(underline.to - underline.from) }, userEvent: 'input.heading-level' }
  }
  return { changes: [
    { from: heading.from, insert: '#'.repeat(target) + ' ' },
    { from: first.to, to: last.to, insert: '' },
  ], userEvent: 'input.heading-level' }
}
