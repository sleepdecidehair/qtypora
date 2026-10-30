import { EditorState } from '@codemirror/state'
import { expect, it } from 'vitest'
import { MAX_DOCUMENT_BYTES } from '../../shared/document-size'
import { tableHtmlChanges } from './table-html-changes'

it('budgets the actual escaped and virtual-cell insertion with BOM and CRLF', () => {
  const table = '| A | B |\n| --- | --- |\n| first | second |\n'
  const prefix = '汉'.repeat(Math.floor((MAX_DOCUMENT_BYTES - 3 - table.length - 30) / 3)) + '\n\n'
  const state = EditorState.create({ doc: prefix + table })
  const from = prefix.length + table.indexOf('first')
  const range = { from, to: from + 'first'.length }
  expect(tableHtmlChanges(state, range, 'x'.repeat(120) + '|<br>y', undefined, 'utf8-bom', 'CRLF')).toBeNull()
  const small = EditorState.create({ doc: table })
  const at = table.indexOf('first')
  const change = tableHtmlChanges(small, { from: at, to: at + 5 }, '**x** | y<br>z', undefined, 'utf8-bom', 'CRLF')
  expect(change?.apply(small.doc).toString()).toContain('**x** \\| y<br>z')
  const virtual = tableHtmlChanges(small, { from: at, to: at }, 'x', ' | ', 'utf8', 'LF')
  expect(virtual?.apply(small.doc).toString()).toContain(' | x |first')
})

it('preserves paragraph boundaries and empty paragraphs within a single cell', () => {
  const source = '| A | B |\n| --- | --- |\n| first | second |\n'
  const state = EditorState.create({ doc: source })
  const from = source.indexOf('first')
  const changes = tableHtmlChanges(state, { from, to: from + 5 }, '**one**\n\n\n\ntwo | end', undefined, 'utf8', 'LF')
  expect(changes?.apply(state.doc).toString()).toBe('| A | B |\n| --- | --- |\n| **one**<br><br><br><br>two \\| end | second |\n')
})
