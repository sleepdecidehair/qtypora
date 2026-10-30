import { describe, expect, it } from 'vitest'
import { EditorState, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { sourceContextTarget, imageContextTarget, tableLinkContextTarget, contextTargetUnchanged, contextObjectSource } from './context-target'
import { contextMenuRequest } from './editor-context'
import { tableOperation } from './table-operations'
import { parser, GFM } from '@lezer/markdown'

const state = (doc: string, readonly = false) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readonly)] })
function apply(doc: string, action: Parameters<typeof tableOperation>[4], row = 1, column = 0): string {
  const changes = tableOperation(doc, 0, row, column, action)
  expect(changes).not.toBeNull()
  return state(doc).update({ changes: changes! }).state.doc.toString()
}

describe('canonical context target ranges', () => {
  it('matches the clicked table link by rendered order and rejects stale or ambiguous cell links', () => {
    const doc = '| 表头 |\n| --- |\n| 前文 [一][first] 和 [二][second] 后文 |\n\n[first]: one.md\n[second]: two.md\n'
    const editor = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    const from = doc.indexOf('前文'), to = doc.indexOf(' 后文') + ' 后文'.length
    const first = tableLinkContextTarget(editor, from, to, ['one.md', 'two.md'], 0)
    const second = tableLinkContextTarget(editor, from, to, ['one.md', 'two.md'], 1)
    expect(first?.source).toBe('[一][first]')
    expect(second?.source).toBe('[二][second]')
    expect(second?.address?.value).toBe('two.md')
    expect(tableLinkContextTarget(editor, from, to, ['two.md'], 0)).toBeNull()
    expect(tableLinkContextTarget(editor, from, to, ['one.md', 'wrong.md'], 1)).toBeNull()
    expect(editor.doc.toString()).toBe(doc)
  })
  it.each([
    ['[文字][id]', '[id]: https://example.test/a', 'https://example.test/a'],
    ['[id][]', '[ID]: https://example.test/a', 'https://example.test/a'],
    ['[id]', '[id]: https://example.test/a', 'https://example.test/a'],
    ['[文字][a\\*b]', '[a\\*b]: <https://example.test/a?x=1&amp;y=2>', 'https://example.test/a?x=1&y=2'],
    ['[文字][id]', '[id]: https://first.test\n[id]: https://second.test', 'https://first.test'],
  ])('resolves reference link %s without modifying source', (link, definition, href) => {
    const doc = `${link}\n\n${definition}`
    const editor = state(doc)
    const target = sourceContextTarget(editor, 2)
    expect(target.kind).toBe('link')
    expect(target.source).toBe(link)
    expect(target.address?.value).toBe(href)
    const menu = contextMenuRequest({ state: editor } as EditorView, target, false)
    expect(menu.availableActions).toContain('copy-link')
    expect(menu.availableActions).toContain('open-link')
    expect(editor.doc.toString()).toBe(doc)
  })
  it('does not expose missing, unsafe or fenced reference links as openable', () => {
    for (const doc of ['[文字][missing]', '```md\n[文字][id]\n```\n\n[id]: https://example.test']) {
      expect(sourceContextTarget(state(doc), doc.indexOf('文字')).kind).not.toBe('link')
    }
    const doc = '[文字][id]\n\n[id]: javascript:alert(1)'
    const editor = state(doc)
    const target = sourceContextTarget(editor, 2)
    const menu = contextMenuRequest({ state: editor } as EditorView, target, false)
    expect(menu.availableActions).not.toContain('open-link')
    expect(editor.doc.toString()).toBe(doc)
  })
  it('locates an image URL separately from its alt text and title', () => {
    const doc = 'Before ![original alt](<images/a file.png> "original title") after'
    const target = sourceContextTarget(state(doc), doc.indexOf('original alt'))
    expect(target.kind).toBe('image')
    expect(doc.slice(target.address!.from, target.address!.to)).toBe('images/a file.png')
    const updated = state(doc).update({ changes: { from: target.address!.from, to: target.address!.to, insert: 'moved.png' } }).state.doc.toString()
    expect(updated).toBe('Before ![original alt](<moved.png> "original title") after')
  })
  it('selects the clicked second image in a shared opaque paragraph', () => {
    const doc = '![one](one.png) ![two](two.png)'
    const target = imageContextTarget(state(doc), 'two.png', 0, doc.length)!
    expect(target.source).toBe('![two](two.png)')
    expect(target.from).toBe(doc.indexOf('![two]'))
  })
  it('maps an HTML image address without replacing unrelated attributes', () => {
    const doc = '<img alt="old alt" src="images/a&amp;b.png" width="200">'
    const target = imageContextTarget(state(doc), 'images/a&b.png', 0, doc.length)!
    expect(target.address!.value).toBe('images/a&b.png')
    expect(state(doc).update({ changes: { from: target.address!.from, to: target.address!.to, insert: 'new.png' } }).state.doc.toString()).toBe('<img alt="old alt" src="new.png" width="200">')
  })
  it('distinguishes fenced code, Mermaid with info metadata, and inline math', () => {
    const doc = '```mermaid title\ngraph LR\nA-->B\n```\n\n```js\nconst a = 1\n```\n\n$x^2$'
    expect(sourceContextTarget(state(doc), doc.indexOf('graph')).kind).toBe('diagram')
    expect(sourceContextTarget(state(doc), doc.indexOf('const')).body!.text).toBe('const a = 1')
    expect(sourceContextTarget(state(doc), doc.indexOf('x^2')).body!.text).toBe('x^2')
  })
  it('keeps the final line of an unclosed code fence and an empty closed fence', () => {
    const unclosed = '```js\nfirst\nlast'
    expect(sourceContextTarget(state(unclosed), 9).body!.text).toBe('first\nlast')
    expect(sourceContextTarget(state('```\n```'), 4).body!.text).toBe('')
  })
  it('copies empty object content as empty text without leaking fence markers', () => {
    const target = sourceContextTarget(state('before\n\n```\n```\n\nafter'), 12)
    expect(target.kind).toBe('code')
    expect(contextObjectSource(target)).toBe('')
    expect(contextObjectSource(sourceContextTarget(state('```js\nconst x = 1\n```'), 9))).toBe('const x = 1')
  })
  it('does not treat dollar signs inside inline code as mathematical formulas', () => {
    const doc = 'before `$not_math$` after'
    const target = sourceContextTarget(state(doc), doc.indexOf('not_math'))
    expect(target.kind).toBe('code')
    expect(target.body!.text).toBe('$not_math$')
  })
  it('rejects stale ranges after target changes or preceding insertions', () => {
    const target = sourceContextTarget(state('before\n![a](a.png)\nafter'), 11)
    expect(contextTargetUnchanged(target, 'before\n![a](a.png)\nafter')).toBe(true)
    expect(contextTargetUnchanged(target, 'before\n![a](b.png)\nafter')).toBe(false)
    expect(contextTargetUnchanged(target, 'new\nbefore\n![a](a.png)\nafter')).toBe(false)
  })
  it('retains the trailing empty line as an insertion target without changing preceding Markdown', () => {
    const doc = '复制 **粗体** 的正文\n'
    const target = sourceContextTarget(state(doc), doc.length)
    expect(target).toEqual({ kind: 'editor', from: doc.length, to: doc.length, source: '' })
    const request = contextMenuRequest({ state: state(doc) } as EditorView, target, false)
    expect(request.availableActions).toContain('paste-plain')
    expect(state(doc).update({ changes: { from: target.from, to: target.to, insert: '[粘贴文本](https://example.com)' } }).state.doc.toString()).toBe(doc + '[粘贴文本](https://example.com)')
  })
})

describe('table structural transactions', () => {
  it('preserves CRLF when inserting and deleting rows', () => {
    const original = '| A | B |\r\n| --- | --- |\r\n| one | two |\r\n| three | four |'
    const apply = (action: 'table-row-after' | 'table-row-delete') => {
      let result = original
      for (const change of [...tableOperation(original, 0, 1, 0, action)!].sort((a, b) => b.from - a.from)) result = result.slice(0, change.from) + change.insert + result.slice(change.to)
      return result
    }
    expect(apply('table-row-delete')).toBe('| A | B |\r\n| --- | --- |\r\n| three | four |')
    const last = tableOperation(original, 0, 2, 0, 'table-row-delete')![0]
    expect(original.slice(0, last.from) + original.slice(last.to)).toBe('| A | B |\r\n| --- | --- |\r\n| one | two |')
    expect(apply('table-row-after')).toBe('| A | B |\r\n| --- | --- |\r\n| one | two |\r\n|   |   |\r\n| three | four |')
    let insertedHeader = original
    for (const change of [...tableOperation(original, 0, 0, 0, 'table-row-before')!].sort((a, b) => b.from - a.from)) insertedHeader = insertedHeader.slice(0, change.from) + change.insert + insertedHeader.slice(change.to)
    expect(insertedHeader).toBe('|   |   |\r\n| --- | --- |\r\n| A | B |\r\n| one | two |\r\n| three | four |')
  })
  it.each(['\n', '\r\n'])('inserts a leading column in bare tables without losing structure using %j', newline => {
    const original = ['A | B', '--- | ---', 'one | two'].join(newline)
    const changes = tableOperation(original, 0, 0, 0, 'table-column-before')!
    let result = original
    for (const change of [...changes].sort((a, b) => b.from - a.from)) result = result.slice(0, change.from) + change.insert + result.slice(change.to)
    expect(parser.configure(GFM).parse(result).toString()).toContain('Table(')
    expect(result).toBe(['|   |A | B', '| --- |--- | ---', '|   |one | two'].join(newline))
  })
  it.each(['\n', '\r\n'])('appends a column in bare tables without losing structure using %j', newline => {
    const original = ['A | B', '--- | ---', 'one | two'].join(newline)
    const changes = tableOperation(original, 0, 0, 1, 'table-column-after')!
    let result = original
    for (const change of [...changes].sort((a, b) => b.from - a.from)) result = result.slice(0, change.from) + change.insert + result.slice(change.to)
    expect(result).toBe(['A | B|   |', '--- | ---| --- |', 'one | two|   |'].join(newline))
    expect(parser.configure(GFM).parse(result.replace(/\r\n/g, '\n')).toString()).toContain('Table(')
  })
  it.each(['\n', '\r\n'])('deletes a short first column without consuming the next row using %j', newline => {
    const original = ['A | B', '--- | ---', 'only', 'next | keep'].join(newline)
    const changes = tableOperation(original, 0, 1, 0, 'table-column-delete')!
    let result = original
    for (const change of [...changes].sort((a, b) => b.from - a.from)) result = result.slice(0, change.from) + change.insert + result.slice(change.to)
    expect(result).toBe(['| B|', '| ---|', '| |', ' keep'].join(newline))
  })
  it('preserves a remaining escaped pipe when deleting to a single column', () => {
    const original = 'A | B\\|C\n--- | ---\nonly\nnext | keep'
    const changes = tableOperation(original, 0, 1, 0, 'table-column-delete')!
    let result = original
    for (const change of [...changes].sort((a, b) => b.from - a.from)) result = result.slice(0, change.from) + change.insert + result.slice(change.to)
    expect(result).toBe('| B\\|C|\n| ---|\n| |\n keep')
  })
  it.each(['\n', '\r\n'])('preserves single-column syntax for each outer pipe form using %j', newline => {
    for (const [header, divider] of [['|A|B', '|---|---'], ['A|B|', '---|---|'], ['A|B', '---|---'], ['|A|B|', '|---|---|']]) {
      const original = [header, divider, 'X'].join(newline)
      const changes = tableOperation(original, 0, 0, 0, 'table-column-delete')!
      let result = original
      for (const change of [...changes].sort((a, b) => b.from - a.from)) result = result.slice(0, change.from) + change.insert + result.slice(change.to)
      expect(parser.configure(GFM).parse(result.replace(/\r\n/g, '\n')).toString()).toContain('Table(')
      expect(result.split(newline)[0]).toBe('|B|')
    }
  })
  const table = '| Name  | Value |\n| :--- | ---: |\n| a\\|b   | untouched |\n| last | keep |'
  it('deletes only the requested body row while preserving all other bytes', () => {
    expect(apply(table, 'table-row-delete')).toBe('| Name  | Value |\n| :--- | ---: |\n| last | keep |')
  })
  it('inserts a row and column without serializing existing cells', () => {
    const row = apply(table, 'table-row-before')
    expect(row).toContain('| a\\|b   | untouched |\n| last | keep |')
    const column = apply(table, 'table-column-after')
    expect(column).toContain('| a\\|b   |   | untouched |')
    expect(column).toContain('| :--- | --- | ---: |')
  })
  it('deletes an escaped-pipe cell without corrupting the remaining column', () => {
    expect(apply(table, 'table-column-delete')).toBe('| Value |\n| ---: |\n| untouched |\n| keep |')
  })
  it.each([['table-align-left', ':---'], ['table-align-center', ':---:'], ['table-align-right', '---:']] as const)('changes only a delimiter cell for %s', (action, marker) => {
    expect(apply(table, action, 1, 1)).toBe(table.replace(' ---: ', ` ${marker} `))
  })
  it('keeps a header, one body row and one column and requires explicit table deletion', () => {
    const minimal = '| A |\n| --- |\n| B |'
    expect(tableOperation(minimal, 0, 0, 0, 'table-row-delete')).toBeNull()
    expect(tableOperation(minimal, 0, 1, 0, 'table-row-delete')).toBeNull()
    expect(tableOperation(minimal, 0, 1, 0, 'table-column-delete')).toBeNull()
    const target = sourceContextTarget(state(minimal), minimal.indexOf('B'))
    const request = contextMenuRequest({ state: state(minimal) } as EditorView, target, false)
    expect(request.availableActions).not.toContain('table-row-delete')
    expect(request.availableActions).not.toContain('table-column-delete')
    expect(request.availableActions).toContain('table-delete')
  })
  it('restores exact original bytes with one undo transaction', () => {
    const prefix = 'Untouched **paragraph**\n\n', suffix = '\n\nTail  '
    const original = prefix + table + suffix
    const view = { state: state(original), dispatch: (transaction: Transaction) => { view.state = transaction.state } }
    const changes = tableOperation(table, prefix.length, 1, 1, 'table-column-delete')!
    view.state = view.state.update({ changes, userEvent: 'input.table-structure' }).state
    expect(view.state.doc.toString()).toBe(prefix + '| Name  |\n| :--- |\n| a\\|b   |\n| last |' + suffix)
    expect(undo(view as unknown as EditorView)).toBe(true)
    expect(view.state.doc.toString()).toBe(original)
  })
  it('offers only copying operations for a read-only table', () => {
    const current = state(table, true)
    const request = contextMenuRequest({ state: current } as EditorView, sourceContextTarget(current, table.indexOf('untouched')), false)
    expect(request.availableActions).toContain('copy-table')
    expect(request.availableActions.some((action) => action.startsWith('table-'))).toBe(false)
    expect(request.availableActions).not.toContain('paste')
  })
})
