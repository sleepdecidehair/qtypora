import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { markdownDocumentModel } from './markdown-config'
import { canFormatSemanticLines } from './semantic-format-guard'

/** Remove complete parsed formatting; reject protected or ambiguous structures. */
export function clearFormatTransaction(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1) return null
  const selection = state.selection.main
  if (selection.empty) return null
  const last = selection.to > selection.from && state.doc.sliceString(selection.to - 1, selection.to) === '\n' ? selection.to - 1 : selection.to
  if (!canFormatSemanticLines(state, state.doc.lineAt(selection.from).from, state.doc.lineAt(last).to)) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree || tree.length < state.doc.length) return null
  const marks: { from: number; to: number }[] = []
  const listItems: { from: number; to: number; indent: number }[] = []
  const listStartLines = new Set<number>()
  let unsafe = false
  tree.iterate({ from: selection.from, to: selection.to, enter(node) {
    if (node.to <= selection.from || node.from >= selection.to) return false
    if (['FencedCode', 'CodeBlock', 'HTMLBlock', 'HTMLTag', 'Autolink'].includes(node.name)) { unsafe = true; return false }
    if (node.name === 'InlineCode') {
      if (node.from < selection.from || node.to > selection.to) { unsafe = true; return false }
      const first = node.node.firstChild, last = node.node.lastChild
      if (!first || !last || first === last || first.name !== 'CodeMark' || last.name !== 'CodeMark') { unsafe = true; return false }
      marks.push({ from: first.from, to: first.to }, { from: last.from, to: last.to })
      return false
    }
    if (node.name === 'Link' || node.name === 'Image') {
      if (node.from < selection.from || node.to > selection.to) { unsafe = true; return false }
      const first = node.node.firstChild
      const close = first?.nextSibling
      let bracket = close
      while (bracket && !(bracket.name === 'LinkMark' && state.doc.sliceString(bracket.from, bracket.to) === ']')) bracket = bracket.nextSibling
      const paren = bracket?.nextSibling
      const inline = paren && state.doc.sliceString(paren.from, paren.to) === '(' && state.doc.sliceString(node.to - 1, node.to) === ')'
      const reference = paren?.name === 'LinkLabel' && paren.to === node.to
      const shortcut = !paren && bracket?.to === node.to
      if (!first || first.name !== 'LinkMark' || !bracket || !(inline || reference || shortcut)) { unsafe = true; return false }
      if (!inline) {
        // Lezer also parses unresolved bracketed text as Link nodes.
        if (state.doc.length > 1024 * 1024) { unsafe = true; return false }
        try {
          const model = markdownDocumentModel(state)
          const parsed = model.parser.parseInline(state.doc.sliceString(node.from, node.to), { references: model.environment.references })[0]?.children
          if (parsed?.[0]?.type !== (node.name === 'Image' ? 'image' : 'link_open')) { unsafe = true; return false }
        } catch { unsafe = true; return false }
      }
      marks.push({ from: first.from, to: first.to }, { from: bracket.from, to: node.to })
    }
    if (/^ATXHeading[1-6]$/.test(node.name) && node.from >= selection.from && node.to <= selection.to && state.doc.lineAt(node.from).from === node.from) {
      const first = node.node.firstChild
      if (!first || first.name !== 'HeaderMark') { unsafe = true; return false }
      let end = first.to
      while (end < node.to && /[ \t]/.test(state.doc.sliceString(end, end + 1))) end++
      marks.push({ from: first.from, to: end })
      const last = node.node.lastChild
      if (last && last !== first && last.name === 'HeaderMark') {
        let start = last.from
        while (start > end && /[ \t]/.test(state.doc.sliceString(start - 1, start))) start--
        marks.push({ from: start, to: last.to })
      }
    }
    if (node.name === 'ListItem') {
      if (node.from < selection.from || node.to > selection.to) { unsafe = true; return false }
      const mark = node.node.firstChild
      if (!mark || mark.name !== 'ListMark') { unsafe = true; return false }
      const line = state.doc.lineAt(mark.from)
      if (line.from < selection.from || !/^ *$/.test(state.doc.sliceString(line.from, mark.from))) { unsafe = true; return false }
      for (let child = mark.nextSibling; child; child = child.nextSibling) if (!['Paragraph', 'Task', 'BulletList', 'OrderedList'].includes(child.name)) { unsafe = true; return false }
      let end = mark.to
      while (end < line.to && /[ \t]/.test(state.doc.sliceString(end, end + 1))) end++
      if (state.doc.sliceString(mark.to, end).includes('\t')) { unsafe = true; return false }
      const indent = end - line.from
      const task = state.doc.sliceString(end, Math.min(end + 4, line.to)).match(/^\[[ xX]\][ \t]/)
      if (task) end += task[0].length
      marks.push({ from: line.from, to: end })
      listStartLines.add(line.from)
      listItems.push({ from: node.from, to: node.to, indent })
    }
    if (node.name === 'QuoteMark') {
      const line = state.doc.lineAt(node.from)
      if (line.from < selection.from || line.to > selection.to || !/^ {0,3}$/.test(state.doc.sliceString(line.from, node.from))) { unsafe = true; return false }
      let end = node.to
      if (end < line.to && /[ \t]/.test(state.doc.sliceString(end, end + 1))) end++
      marks.push({ from: node.from, to: end })
    }
    if (['StrongEmphasis', 'Emphasis', 'Strikethrough'].includes(node.name)) {
      if (node.from < selection.from || node.to > selection.to) { unsafe = true; return false }
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name === 'EmphasisMark' || child.name === 'StrikethroughMark') marks.push({ from: child.from, to: child.to })
      }
    }
  } })
  if (!unsafe && listItems.length) {
    const first = state.doc.lineAt(selection.from).number, last = state.doc.lineAt(selection.to).number
    if (last - first > 2000 || listItems.length > 1000) unsafe = true
    for (let number = first; !unsafe && number <= last; number++) {
      const line = state.doc.line(number)
      if (listStartLines.has(line.from) || !line.text.trim()) continue
      const items = listItems.filter(item => item.from < line.from && item.to >= line.to)
      if (!items.length) continue
      const indent = Math.max(...items.map(item => item.indent))
      const leading = line.text.match(/^[ \t]*/)?.[0] ?? ''
      if (leading.includes('\t') || (leading.length > 0 && leading.length < indent) || line.from < selection.from || line.to > selection.to) { unsafe = true; break }
      if (leading.length) marks.push({ from: line.from, to: line.from + indent })
    }
  }
  if (unsafe || !marks.length) return null
  marks.sort((left, right) => left.from - right.from || left.to - right.to)
  if (marks.some((mark, index) => index > 0 && mark.from < marks[index - 1].to)) return null
  const changes = state.changes(marks)
  return { changes, selection: EditorSelection.single(changes.mapPos(selection.anchor, -1), changes.mapPos(selection.head, 1)), annotations: [Transaction.userEvent.of('input.format'), isolateHistory.of('full')], scrollIntoView: true }
}
