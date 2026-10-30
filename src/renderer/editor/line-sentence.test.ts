import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it, vi } from 'vitest'
import { deleteLineSentence, selectLineSentence } from './line-sentence'

const parserControl = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parserControl.incomplete ? null : actual.ensureSyntaxTree(...args) }
})

const create = (doc: string, anchor: number, readOnly = false) => EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(readOnly)] })
const select = (state: EditorState, mode: 'source' | 'hybrid' = 'hybrid') => {
  const change = selectLineSentence(state, mode)
  if (!change) return null
  const next = state.update(change).state
  return next.doc.sliceString(next.selection.main.from, next.selection.main.to)
}

describe('current line or sentence', () => {
  it('selects the Unicode sentence containing the caret and deletes it without affecting neighbors', () => {
    const source = '第一句😀。第二句！最后一句'
    const state = create(source, source.indexOf('第二'))
    expect(select(state)).toBe('第二句！')
    expect(state.update(deleteLineSentence(state, 'hybrid')!).state.doc.toString()).toBe('第一句😀。最后一句')
  })
  it('uses sentence boundaries across a multiline paragraph', () => {
    const source = 'First sentence. Second\ncontinued! Third.'
    const state = create(source, source.indexOf('continued'))
    expect(select(state)).toBe('Second\ncontinued! ')
  })
  it('deletes a code body line while preserving both fences and neighboring code', () => {
    const source = '```js\nfirst\nsecond\n```\n\nend'
    const state = create(source, source.indexOf('first'))
    expect(select(state)).toBe('first')
    expect(state.update(deleteLineSentence(state, 'hybrid')!).state.doc.toString()).toBe('```js\nsecond\n```\n\nend')
    const only = create('```\nbody\n```', 5)
    expect(only.update(deleteLineSentence(only, 'hybrid')!).state.doc.toString()).toBe('```\n\n```')
  })
  it('keeps mathematical delimiters and deletes only the selected inner line', () => {
    const source = '$$\nx + y\nz\n$$'
    const state = create(source, source.indexOf('x'))
    expect(state.update(deleteLineSentence(state, 'hybrid')!).state.doc.toString()).toBe('$$\nz\n$$')
    expect(deleteLineSentence(create(source, 0), 'hybrid')).toBeNull()
  })
  it('selects and deletes table rows through existing table constraints', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
    const state = create(source, source.indexOf('1'))
    expect(select(state)).toBe('| 1 | 2 |')
    expect(state.update(deleteLineSentence(state, 'hybrid')!).state.doc.toString()).toBe('| A | B |\n| --- | --- |\n| 3 | 4 |')
    expect(deleteLineSentence(create(source, 2), 'hybrid')).toBeNull()
  })
  it('refuses partial formatted syntax and special blocks rather than damaging source', () => {
    const source = '**First. Second.**'
    expect(deleteLineSentence(create(source, 4), 'hybrid')).toBeNull()
    expect(deleteLineSentence(create('---\ntitle: X\n---', 5), 'hybrid')).toBeNull()
  })
  it('deletes an empty line and respects read-only', () => {
    const source = 'a\n\nb'
    const state = create(source, 2)
    expect(state.update(deleteLineSentence(state, 'hybrid')!).state.doc.toString()).toBe('a\nb')
    expect(deleteLineSentence(create('hello', 1, true), 'hybrid')).toBeNull()
  })
  it('refuses multiline quoted and list sentences that cross structural prefixes', () => {
    for (const source of ['> First.\n> Second.', '- First.\n  Second.']) {
      const state = create(source, source.indexOf('First'))
      expect(deleteLineSentence(state, 'hybrid')).toBeNull()
      expect(state.doc.toString()).toBe(source)
    }
  })
  it('refuses partial inline math and extended syntax instead of leaving unmatched markers', () => {
    for (const source of ['Text $x. Y$ after.', 'Text ==first. Second== after.', 'Text ~first. Second~ after.', 'Text ^first. Second^ after.']) {
      const state = create(source, source.indexOf('first') < 0 ? source.indexOf('x') : source.indexOf('first'))
      expect(deleteLineSentence(state, 'hybrid')).toBeNull()
    }
  })
  it('undoes a sentence deletion without changing Unicode content', () => {
    const source = '第一句😀。第二句！最后一句'
    let state = create(source, source.indexOf('第二'))
    state = state.update(deleteLineSentence(state, 'hybrid')!).state
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(source)
  })
  it('handles the first and last lines of indented code', () => {
    const source = '    first\n    second\n    third'
    expect(create(source, 6).update(deleteLineSentence(create(source, 6), 'hybrid')!).state.doc.toString()).toBe('    second\n    third')
    const last = create(source, source.indexOf('third'))
    expect(last.update(deleteLineSentence(last, 'hybrid')!).state.doc.toString()).toBe('    first\n    second')
  })
  it('always uses raw source lines, including YAML and documents beyond the preview budget', () => {
    for (const source of ['---\ntitle: test\n---\n', 'a'.repeat(200001) + '\nlast']) {
      const state = create(source, 1)
      const selected = select(state, 'source')
      expect(selected).toBe(source.split('\n')[0])
      const updated = state.update(deleteLineSentence(state, 'source')!).state
      expect(updated.doc.toString()).toBe(source.slice(source.indexOf('\n') + 1))
    }
  })
  it('refuses preview edits when the syntax tree is incomplete while preserving source mode', () => {
    const state = create('Text **First. Second.**\n\n' + 'other\n\n'.repeat(1000), 9)
    parserControl.incomplete = true
    try {
      expect(selectLineSentence(state, 'hybrid')).toBeNull()
      expect(deleteLineSentence(state, 'hybrid')).toBeNull()
      expect(state.doc.toString()).toContain('**First. Second.**')
      expect(selectLineSentence(state, 'source')).not.toBeNull()
      expect(deleteLineSentence(state, 'source')).not.toBeNull()
    } finally { parserControl.incomplete = false }
  })
  it('supports source lines and one-step undo', () => {
    const source = 'first line\nsecond line'
    let state = create(source, 2)
    expect(select(state, 'source')).toBe('first line')
    state = state.update(deleteLineSentence(state, 'source')!).state
    const target = { get state() { return state }, dispatch(spec: Parameters<typeof state.update>[0]) { state = state.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(state.doc.toString()).toBe(source)
  })
})
