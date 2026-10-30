import { markdown } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { smartDashInput } from './smart-dash-input'
import { DEFAULT_MARKDOWN_OPTIONS, effectiveMarkdownOptions, normalizeMarkdownOptions } from '../../shared/markdown-options'

function state(doc: string, position = doc.length, readonly = false) { return EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown(), history(), EditorState.readOnly.of(readonly)] }) }
describe('smart dash input', () => {
  it('defaults off for old settings and is disabled in strict mode', () => {
    const { smartDashInput: _newOption, ...old } = DEFAULT_MARKDOWN_OPTIONS
    expect(normalizeMarkdownOptions(old).smartDashInput).toBe(false)
    expect(effectiveMarkdownOptions({ ...DEFAULT_MARKDOWN_OPTIONS, smartDashInput: true, strictMode: true }).smartDashInput).toBe(false)
    expect(effectiveMarkdownOptions({ ...DEFAULT_MARKDOWN_OPTIONS, smartPunctuation: true }).smartPunctuation).toBe(true)
  })
  it.each([['hello-', '-', 'hello–'], ['hello–', '-', 'hello—'], ['hello--', '-', 'hello—'], ['hello..', '.', 'hello…']])('replaces a typed sequence and undoes it: %s', (doc, text, expected) => {
    let current = state(doc)
    const change = smartDashInput(current, doc.length, doc.length, text, true)!
    expect(change).not.toBeNull()
    current = current.update(change).state
    expect(current.doc.toString()).toBe(expected)
    expect(undo({ state: current, dispatch: tr => { current = tr.state } })).toBe(true)
    expect(current.doc.toString()).toBe(doc)
  })
  it('does not run when disabled, read-only or modifying a selection', () => {
    const current = state('hello-')
    expect(smartDashInput(current, 6, 6, '-', false)).toBeNull()
    expect(smartDashInput(state('hello-', 6, true), 6, 6, '-', true)).toBeNull()
    expect(smartDashInput(current, 5, 6, '-', true)).toBeNull()
  })
  it('does not touch code, links, math, YAML, escaped input or list prefixes', () => {
    for (const doc of ['```\nhello-\n```', '`hello-`', '[hello-](https://a)', '$$\nhello-\n$$', '---\ntitle: hello-\n---', 'hello\\-', '-']) {
      const position = doc.lastIndexOf('-') + 1
      expect(smartDashInput(state(doc, position), position, position, '-', true), doc).toBeNull()
    }
  })
})
