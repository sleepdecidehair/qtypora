import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/** Ordinary and quoted paragraphs; lists keep their existing layout. */
export function paragraphIndentLines(state: EditorState, ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }]): number[] {
  const lines = new Set<number>()
  for (const range of ranges) syntaxTree(state).iterate({ from: range.from, to: range.to, enter(node) {
    if (node.name === 'Paragraph' && (node.node.parent?.name === 'Document' || node.node.parent?.name === 'Blockquote')) {
      for (let parent: SyntaxNode | null = node.node.parent; parent; parent = parent.parent) if (parent.name === 'ListItem') return false
      const from = state.doc.lineAt(node.from).from
      if (from >= range.from && from <= range.to) lines.add(from)
    }
  } })
  return [...lines].sort((a, b) => a - b)
}

function decorations(view: EditorView): DecorationSet {
  return Decoration.set(paragraphIndentLines(view.state, view.visibleRanges).map(from => Decoration.line({ class: 'cm-paragraph-first-line-indent' }).range(from)))
}

export const paragraphIndent = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = decorations(view) }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorations(update.view)
  }
}, { decorations: value => value.decorations })
