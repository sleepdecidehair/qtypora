import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { inlinePreviewSpans, styleScope } from './live-inline'
import { parseTableSource, tableCellEdit } from './table-model'
import { hybridExtension } from './hybrid'
import { editLiveBlock, LiveBlockWidget, liveBlocks } from './live-blocks'
import { sourceEditRange } from './live-source-edit'
import { markdownParser } from './markdown'

const state = (doc: string, cursor: number) => EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage })] })

describe('live Markdown native text decorations', () => {
  it('marks standalone image paragraphs for centering while preserving images embedded in text', () => {
    expect(markdownParser.render('![照片](photo.png)')).toContain('class="md-image-paragraph"')
    expect(markdownParser.render('![一](a.png) ![二](b.png)')).toContain('class="md-image-paragraph"')
    expect(markdownParser.render('文字 ![图标](icon.png) 后续文字')).not.toContain('md-image-paragraph')
    expect(markdownParser.render('普通文字')).not.toContain('md-image-paragraph')
  })
  it.each(['#', '##', '###', '####', '#####', '######'])('keeps %s visible until its heading separator is typed', (prefix) => {
    let current = state(prefix, prefix.length)
    expect(inlinePreviewSpans(current)).toEqual([])
    current = current.update({ changes: { from: prefix.length, insert: ' ' }, selection: { anchor: prefix.length + 1 } }).state
    expect(inlinePreviewSpans(current)).toContainEqual({ from: 0, to: prefix.length + 1, hidden: true })
    current = current.update({ changes: { from: prefix.length, to: prefix.length + 1 }, selection: { anchor: prefix.length } }).state
    expect(inlinePreviewSpans(current)).toEqual([])
    expect(current.doc.toString()).toBe(prefix)
  })
  it('keeps heading style and hidden heading markers when its text is being edited', () => {
    const spans = inlinePreviewSpans(state('# 标题\n\nparagraph', 3))
    expect(spans).toContainEqual({ from: 0, to: 0, line: true, className: 'cm-live-heading cm-live-heading-1' })
    expect(spans).toContainEqual({ from: 0, to: 2, hidden: true })
  })
  it('expands only the focused inline emphasis instead of its entire paragraph', () => {
    const spans = inlinePreviewSpans(state('**one** and **two**', 3))
    expect(spans.some((span) => span.hidden && span.from < 7)).toBe(false)
    expect(spans.filter((span) => span.hidden).map(({ from, to }) => [from, to])).toEqual([[12, 14], [17, 19]])
  })
  it('selects the content of the nearest style scope', () => {
    const current = state('before **中文** after', 10)
    const scope = styleScope(current)
    expect(current.doc.sliceString(scope.from, scope.to)).toBe('中文')
  })
})

describe('rendered table cell transactions', () => {
  it('updates one cell while preserving delimiters, spacing, alignment and unrelated source', () => {
    const source = '| Name  | Value |\n| :--- | ---: |\n| old   | untouched |'
    const table = parseTableSource(source)
    const edit = tableCellEdit(table.cells[2], '新的值')!
    expect(source.slice(0, edit.from) + edit.insert + source.slice(edit.to)).toBe('| Name  | Value |\n| :--- | ---: |\n| 新的值   | untouched |')
  })
  it('does not split escaped pipes and escapes newly typed pipes once', () => {
    const table = parseTableSource('| A | B |\n| --- | --- |\n| a\\|b | c |')
    expect(table.cells[2].content).toBe('a\\|b')
    expect(tableCellEdit(table.cells[2], 'x|y\\|z')?.insert).toBe('x\\|y\\|z')
  })
  it('keeps an empty cell’s surrounding padding and offsets into the canonical document', () => {
    const source = '| A | B |\n| --- | --- |\n|   | c |'
    const cell = parseTableSource(source, 100, 10).cells[2]
    expect(cell.line).toBe(12)
    expect(cell.from).toBe(cell.to)
    const edit = tableCellEdit(cell, '填入')!
    expect(source.slice(0, edit.from - 100) + edit.insert + source.slice(edit.to - 100)).toContain('| 填入  | c |')
  })
  it('undo restores the exact canonical table including legacy spacing', () => {
    const original = '| A  | B |\n| :--- | ---: |\n| old   | untouched |'
    let current = EditorState.create({ doc: original, extensions: [history()] })
    const edit = tableCellEdit(parseTableSource(original).cells[2], '中文')!
    current = current.update({ changes: edit, userEvent: 'input.table' }).state
    expect(undo({ state: current, dispatch: (transaction) => { current = transaction.state } })).toBe(true)
    expect(current.doc.toString()).toBe(original)
  })
})

describe('opaque live blocks require explicit edit focus', () => {
  const options = { theme: 'light' as const, focusMode: false, readOnly: false, resolveResource: async (source: string) => source, onLinkOpen: () => undefined }
  const previewCount = (current: EditorState): number => {
    let count = 0
    for (const decorations of current.facet(EditorView.decorations)) {
      if (typeof decorations === 'function') continue
      decorations.between(0, current.doc.length, (_from, _to, value) => { if (value.spec.widget instanceof LiveBlockWidget) count++ })
    }
    return count
  }
  it('does not reveal a diagram merely because a cursor already lies in its source', () => {
    const doc = '# Heading\n\n```mermaid\ngraph LR\nA-->B\n```\n\nAfter'
    let current = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), hybridExtension(options)] })
    current = current.update({ selection: { anchor: doc.indexOf('A-->B') } }).state
    expect(previewCount(current)).toBe(1)
    expect(current.doc.toString()).toBe(doc)
  })
  it('opens only the requested math block and returns to preview when the cursor leaves it', () => {
    const doc = '$$x^2$$\n\nAfter'
    let current = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), hybridExtension(options)] })
    const block = liveBlocks(current)[0]
    current = current.update({ effects: editLiveBlock.of({ from: block.from, to: block.to }), selection: { anchor: 3 } }).state
    expect(previewCount(current)).toBe(0)
    current = current.update({ selection: { anchor: doc.length } }).state
    expect(previewCount(current)).toBe(1)
    expect(current.doc.toString()).toBe(doc)
  })
  it('reveals all heading and inline syntax while its selection is focused without changing the canonical source', () => {
    const doc = '## **标题**\n\n正文 **粗体**\n\n结束'
    let current = EditorState.create({ doc, selection: { anchor: doc.indexOf('\n') }, extensions: [markdown({ base: markdownLanguage }), hybridExtension(options)] })
    const classes: string[] = []
    for (const decoration of current.facet(EditorView.decorations)) {
      if (typeof decoration === 'function') continue
      decoration.between(0, doc.length, (_from, _to, value) => { if (value.spec.class) classes.push(value.spec.class) })
    }
    expect(classes).toContain('cm-live-edit-line')
    expect(classes).not.toContain('cm-live-heading cm-live-heading-2')
    expect(current.doc.toString()).toBe(doc)
    current = current.update({ selection: { anchor: doc.length } }).state
    const collapsedClasses: string[] = []
    for (const decorations of current.facet(EditorView.decorations)) {
      if (typeof decorations === 'function') continue
      decorations.between(0, doc.length, (_from, _to, value) => { if (value.spec.class) collapsedClasses.push(value.spec.class) })
    }
    expect(collapsedClasses).toContain('cm-live-heading cm-live-heading-2')
    expect(current.doc.toString()).toBe(doc)
    expect(inlinePreviewSpans(current)).toContainEqual({ from: 0, to: 3, hidden: true })
  })
  it('reveals both lines of a setext heading and the whole code fence', () => {
    expect(sourceEditRange(state('标题\n---\n\n正文', 1), 1)).toEqual({ from: 0, to: 6 })
    const doc = '前文\n\n```js\nconst answer = 42\n```\n\n结束'
    expect(sourceEditRange(state(doc, 15), 15)).toEqual({ from: 4, to: doc.indexOf('\n\n结束') })
  })
})
