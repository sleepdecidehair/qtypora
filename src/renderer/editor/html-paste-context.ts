import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorSelection, EditorState } from '@codemirror/state'
import { markdownDocumentModel } from './markdown-config'

export type HtmlPasteContext = { kind: 'normal' | 'unsafe' } | { kind: 'code'; text: string }

/** Determine whether an HTML paste must retain literal clipboard text. */
export function htmlPasteContext(state: EditorState, plainText: string, selection: EditorSelection = state.selection): HtmlPasteContext {
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return { kind: 'unsafe' }
  let inCode = 0, unsafe = false, insertion = plainText
  for (const range of selection.ranges) {
    tree.iterate({ enter(node) {
      if (!['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return
      const unclosedEnd = node.name === 'CodeBlock' || (node.name === 'FencedCode' && node.node.getChildren('CodeMark').length < 2)
      const start = node.name === 'CodeBlock' ? state.doc.lineAt(node.from).from : node.from
      const intersects = range.empty
        ? (node.name === 'CodeBlock' ? range.from >= start : range.from > start) && (range.from < node.to || (range.from === node.to && unclosedEnd))
        : range.from < node.to && range.to > start
      if (!intersects) return false
      let from: number, to: number
      if (node.name === 'FencedCode') {
        const marks = node.node.getChildren('CodeMark')
        if (!marks.length) { unsafe = true; return false }
        const first = state.doc.lineAt(marks[0].from)
        from = Math.min(first.to + 1, node.to)
        to = marks.length > 1 ? state.doc.lineAt(marks[1].from).from - 1 : node.to
        if (range.from < from || range.to > to) { unsafe = true; return false }
        const marker = state.doc.sliceString(marks[0].from, marks[0].to)
        let prefix = ''
        if (node.node.parent?.name !== 'Document') {
          if (marks.length !== 2) { unsafe = true; return false }
          const last = state.doc.lineAt(marks[1].from)
          const token = markdownDocumentModel(state).tokens.find(token => token.type === 'fence' && token.map?.[0] === first.number - 1)
          if (!token || !token.content.endsWith('\n')) { unsafe = true; return false }
          const lines = token.content.slice(0, -1).split('\n')
          if (lines.length !== last.number - first.number - 1) { unsafe = true; return false }
          for (let index = 0; index < lines.length; index++) {
            const line = state.doc.line(first.number + index + 1), logical = lines[index]
            if (!line.text.endsWith(logical)) { unsafe = true; return false }
            const candidate = line.text.slice(0, line.text.length - logical.length)
            if (index === 0) prefix = candidate
            else if (candidate !== prefix) { unsafe = true; return false }
          }
          const line = state.doc.lineAt(range.from)
          if (state.doc.lineAt(range.to).number !== line.number || range.from < line.from + prefix.length || range.to > line.to) { unsafe = true; return false }
          insertion = plainText.replace(/\r\n?|\n/g, '\n' + prefix)
        }
        let body = state.doc.sliceString(from, range.from) + insertion + state.doc.sliceString(range.to, to)
        if (prefix) {
          const lines = body.split('\n')
          if (lines.some(line => !line.startsWith(prefix))) { unsafe = true; return false }
          body = lines.map(line => line.slice(prefix.length)).join('\n')
        }
        const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`, 'm')
        if (closing.test(body.replace(/\r\n?/g, '\n'))) unsafe = true
      } else if (node.name === 'InlineCode') {
        const marks = node.node.getChildren('CodeMark')
        if (marks.length !== 2 || range.from < marks[0].to || range.to > marks[1].from || /[`\r\n]/.test(plainText)) { unsafe = true; return false }
      } else {
        if (node.node.parent?.name !== 'Document' || /[\r\n]/.test(plainText)) { unsafe = true; return false }
        const line = state.doc.lineAt(range.from)
        const body = node.node.getChildren('CodeText').find(text => text.from >= line.from && text.from <= line.to)
        if (!body || range.from < body.from || range.to > Math.min(body.to, line.to)) { unsafe = true; return false }
      }
      inCode++
      return false
    } })
  }
  if (unsafe || (inCode && (selection.ranges.length !== 1 || inCode !== 1))) return { kind: 'unsafe' }
  return inCode ? { kind: 'code', text: insertion } : { kind: 'normal' }
}
