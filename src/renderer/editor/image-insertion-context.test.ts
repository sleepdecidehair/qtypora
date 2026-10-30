import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { expect, it } from 'vitest'
import { emptyTableCellIdentity, hasCompleteTable, imageInsertionContext } from './image-insertion-context'

it('identifies a single table cell and rejects selection across table boundaries', () => {
  const doc = 'intro\n\n| A | B |\n| --- | --- |\n| first | second |\n\nafter'
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  const first = doc.indexOf('first'), second = doc.indexOf('second')
  expect(imageInsertionContext(state, { from: first, to: first + 5 })).toBe('table')
  expect(imageInsertionContext(state, { from: first + 5, to: first + 5 })).toBe('table')
  expect(imageInsertionContext(state, { from: first, to: second + 6 })).toBeNull()
  expect(imageInsertionContext(state, { from: doc.indexOf('| ---'), to: doc.indexOf('| ---') })).toBeNull()
  expect(imageInsertionContext(state, { from: 1, to: 1 })).toBe('text')
  expect(imageInsertionContext(state, { from: 1, to: first })).toBeNull()
  expect(hasCompleteTable(state, doc.indexOf('| A'), doc.indexOf('\n\nafter'))).toBe(true)
})

it('finds an actual empty cell without treating separators as cells', () => {
  const doc = '| A | B |\n| --- | --- |\n|  | x |'
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  const at = doc.lastIndexOf('|  |') + 2
  expect(emptyTableCellIdentity(state, { from: at, to: at })).toEqual({ tableFrom: 0, tableTo: doc.length, row: 1, column: 0 })
  const divider = doc.indexOf('| ---')
  expect(emptyTableCellIdentity(state, { from: divider, to: divider })).toBeNull()
  expect(emptyTableCellIdentity(state, { from: at, to: at + 1 })).toBeNull()
})

it('refuses insertion when no complete Markdown syntax tree is available', () => {
  expect(imageInsertionContext(EditorState.create({ doc: '| A |\n| --- |\n| x |' }), { from: 0, to: 0 })).toBeNull()
})

it('refuses either half of a table escape but allows the complete escape', () => {
  const doc = '| A | B |\n| --- | --- |\n| a\\|b | x |'
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  const at = doc.indexOf('\\|')
  expect(imageInsertionContext(state, { from: at, to: at + 1 })).toBeNull()
  expect(imageInsertionContext(state, { from: at + 1, to: at + 2 })).toBeNull()
  expect(imageInsertionContext(state, { from: at + 1, to: at + 1 })).toBeNull()
  expect(imageInsertionContext(state, { from: at, to: at + 2 })).toBe('table')
  expect(imageInsertionContext(state, { from: at - 1, to: at })).toBe('table')
})

it('rejects partial entities and graphemes while allowing whole characters', () => {
  const doc = '| A | B |\n| --- | --- |\n| a&amp;b👩‍💻c | x |'
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  const entity = doc.indexOf('&amp;'), emoji = doc.indexOf('👩‍💻')
  expect(imageInsertionContext(state, { from: entity + 1, to: entity + 4 })).toBeNull()
  expect(imageInsertionContext(state, { from: entity, to: entity + 5 })).toBe('table')
  expect(imageInsertionContext(state, { from: emoji, to: emoji + 2 })).toBeNull()
  expect(imageInsertionContext(state, { from: emoji, to: emoji + '👩‍💻'.length })).toBe('table')
})
