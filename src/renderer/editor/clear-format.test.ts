import { markdown } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { clearFormatTransaction } from './clear-format'

function fixture(doc: string, anchor = 0, head = doc.length, readOnly = false) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [markdown({ extensions: [GFM] }), history(), EditorState.readOnly.of(readOnly)] })
  const view = { get state() { return state }, dispatch(spec: TransactionSpec) { state = state.update(spec).state } } as unknown as EditorView
  return { view, get state() { return state }, apply() { const edit = clearFormatTransaction(state); if (edit) state = state.update(edit).state; return edit } }
}

describe('clear formatting without corrupting Markdown', () => {
  it('removes parsed nested emphasis and supports one undo', () => {
    const target = fixture('**strong and *emphasis***')
    expect(target.apply()).not.toBeNull()
    expect(target.state.doc.toString()).toBe('strong and emphasis')
    expect(undo(target.view)).toBe(true)
    expect(target.state.doc.toString()).toBe('**strong and *emphasis***')
  })
  it('refuses fenced code, including mixed selections', () => {
    for (const text of ['```\n**keep**\n```', '**bold**\n\n```\n**keep**\n```']) {
      const target = fixture(text)
      expect(target.apply()).toBeNull()
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('preserves YAML and formula contents during format clearing', () => {
    for (const text of ['---\nkey: **literal**\n---', '$$\n**formula**\n$$']) {
      const target = fixture(text)
      expect(target.apply()).toBeNull()
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('clears complete links, images and inline code while preserving their visible contents', () => {
    for (const [text, expected] of [['[**bold**](https://example.com)', 'bold'], ['![alt](image.png)', 'alt'], ['**bold** and `**code**`', 'bold and **code**'], ['~~strike~~', 'strike']]) {
      const target = fixture(text)
      expect(target.apply()).not.toBeNull()
      expect(target.state.doc.toString()).toBe(expected)
      expect(undo(target.view)).toBe(true)
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('clears complete single-line headings, quotes and list markers', () => {
    for (const [text, expected] of [['# **heading**', 'heading'], ['## heading ##', 'heading'], ['> quote', 'quote'], ['- item', 'item'], ['1. item', 'item'], ['- [ ] task', 'task']]) {
      const target = fixture(text)
      expect(target.apply()).not.toBeNull()
      expect(target.state.doc.toString()).toBe(expected)
      expect(undo(target.view)).toBe(true)
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('refuses partially selected markup instead of changing structure', () => {
    expect(fixture('**bold**', 1, 7).apply()).toBeNull()
    expect(fixture('**bold**', 0, 8, true).apply()).toBeNull()
    expect(fixture('- parent\n  > nested quote').apply()).toBeNull()
    expect(fixture('- item\n  ```\n  code\n  ```').apply()).toBeNull()
  })
  it('clears simple nested and multi-line lists without losing text or excess indentation', () => {
    for (const [text, expected] of [['- parent\n  - child\n    continuation', 'parent\nchild\ncontinuation'], ['- first\n  continuation\n\n  next', 'first\ncontinuation\n\nnext'], ['- one\n    extra indentation', 'one\n  extra indentation']]) {
      const target = fixture(text)
      expect(target.apply()).not.toBeNull()
      expect(target.state.doc.toString()).toBe(expected)
      expect(undo(target.view)).toBe(true)
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('clears selected reference links without changing shared definitions or other references', () => {
    const text = '[first][ref] and [second][ref]\n\n[ref]: /target'
    const target = fixture(text, 0, '[first][ref]'.length)
    expect(target.apply()).not.toBeNull()
    expect(target.state.doc.toString()).toBe('first and [second][ref]\n\n[ref]: /target')
    expect(undo(target.view)).toBe(true)
    expect(target.state.doc.toString()).toBe(text)
    for (const [source, selected, expected] of [['[ref][]\n\n[ref]: /target', '[ref][]', 'ref\n\n[ref]: /target'], ['![alt][ref]\n\n[ref]: img.png', '![alt][ref]', 'alt\n\n[ref]: img.png'], ['[ref]\n\n[ref]: /target', '[ref]', 'ref\n\n[ref]: /target']]) {
      const item = fixture(source, 0, selected.length)
      expect(item.apply()).not.toBeNull()
      expect(item.state.doc.toString()).toBe(expected)
      expect(undo(item.view)).toBe(true)
      expect(item.state.doc.toString()).toBe(source)
    }
  })
  it('preserves unresolved or escaped bracketed text', () => {
    for (const text of ['[plain]', '[first][missing]', '![alt][missing]', '\\[escaped\\]', '[first][]\n\n[other]: /target']) {
      const target = fixture(text)
      expect(target.apply()).toBeNull()
      expect(target.state.doc.toString()).toBe(text)
    }
  })
  it('preserves reverse selection orientation and escaped literal markers', () => {
    const target = fixture('\\*literal\\* and **bold**', 24, 0)
    expect(target.apply()).not.toBeNull()
    expect(target.state.doc.toString()).toBe('\\*literal\\* and bold')
    expect(target.state.selection.main.anchor).toBeGreaterThan(target.state.selection.main.head)
  })
})
