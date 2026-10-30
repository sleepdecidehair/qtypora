import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { toggleUnderline } from './underline'
import { underlineMultiline } from './underline-multiline'

const parserControl = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parserControl.incomplete ? null : actual.ensureSyntaxTree(...args) }
})
const create = (doc: string, from: number, to: number) => EditorState.create({ doc, selection: EditorSelection.range(from, to), extensions: [markdown({ base: markdownLanguage }), history()] })

describe('underline with incomplete syntax trees', () => {
  const prefix = 'text\n\n'.repeat(1800)
  it('never adds tags inside a late code fence', () => {
    const doc = prefix + '```js\nconst abc = 1\n```'
    const at = doc.indexOf('abc')
    const state = create(doc, at, at + 3)
    expect(toggleUnderline(state)).toBeNull()
    expect(state.doc.toString()).toBe(doc)
  })
  it('removes rather than nesting a late existing underline and restores it with undo', () => {
    const doc = prefix + '<u>abc</u>'
    const at = doc.indexOf('abc')
    let state = create(doc, at, at + 3)
    const edit = toggleUnderline(state)
    if (!edit) throw new Error('Expected underline removal')
    state = state.update(edit).state
    expect(state.doc.toString()).toBe(prefix + 'abc')
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(doc)
  })
  it('refuses both single-line and multiline edits if full parsing is unavailable', () => {
    const doc = prefix + 'first line\nsecond line'
    const at = prefix.length
    const one = create(doc, at, at + 5), two = create(doc, at, doc.length)
    parserControl.incomplete = true
    try {
      expect(toggleUnderline(one)).toBeNull()
      expect(underlineMultiline(two)).toBeNull()
      expect(one.doc.toString()).toBe(doc)
      expect(two.doc.toString()).toBe(doc)
    } finally { parserControl.incomplete = false }
  })
})
