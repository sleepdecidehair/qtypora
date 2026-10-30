import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { insertYamlFrontMatter } from './yaml-insert'

function fixture(doc: string, options: { readOnly?: boolean; enabled?: boolean; strict?: boolean; anchor?: number; head?: number } = {}) {
  return EditorState.create({ doc, selection: EditorSelection.range(options.anchor ?? 0, options.head ?? options.anchor ?? 0), extensions: [history(), EditorState.readOnly.of(!!options.readOnly), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, frontMatter: options.enabled ?? true, strictMode: !!options.strict })] })
}

describe('insert YAML front matter', () => {
  it.each(['', 'hello', '# title\n\nbody', '\ntext'])('inserts at document start without changing existing content and undoes once: %j', doc => {
    let state = fixture(doc, { anchor: doc.length })
    const transaction = insertYamlFrontMatter(state)!
    expect(transaction).not.toBeNull()
    state = state.update(transaction).state
    expect(state.doc.toString()).toBe('---\n\n---\n' + (doc ? '\n' + doc : ''))
    expect(undo({ state, dispatch: tx => { state = tx.state } })).toBe(true)
    expect(state.doc.toString()).toBe(doc)
  })
  it('rejects existing or ambiguous opening delimiters and unsafe requests', () => {
    for (const doc of ['---\nkey: value\n---\ntext', '---\nunterminated', '---', '\ufefftext']) expect(insertYamlFrontMatter(fixture(doc))).toBeNull()
    expect(insertYamlFrontMatter(fixture('text', { readOnly: true }))).toBeNull()
    expect(insertYamlFrontMatter(fixture('text', { enabled: false }))).toBeNull()
    expect(insertYamlFrontMatter(fixture('text', { strict: true }))).toBeNull()
    expect(insertYamlFrontMatter(fixture('text', { anchor: 0, head: 2 }))).toBeNull()
  })
})
