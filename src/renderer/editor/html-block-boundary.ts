import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

/** Unclosed HTML constructs keep consuming text across blank lines. */
export function isUnclosedHtmlBlock(state: EditorState, node: SyntaxNode): boolean {
  if (node.name !== 'HTMLBlock' && node.name !== 'CommentBlock') return false
  const text = state.doc.sliceString(node.from, node.to)
  if (/^\s*<!--/.test(text)) return !text.includes('-->')
  if (/^\s*<\?/.test(text)) return !text.includes('?>')
  if (/^\s*<!\[CDATA\[/.test(text)) return !text.includes(']]>')
  if (/^\s*<![A-Z]/.test(text)) return !text.includes('>')
  const tag = text.match(/^\s*<(script|pre|style|textarea)(?:\s|>|$)/i)?.[1]
  return !!tag && !new RegExp(`</${tag}\\s*>`, 'i').test(text)
}
