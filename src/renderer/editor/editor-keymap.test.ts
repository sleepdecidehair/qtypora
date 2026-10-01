import { defaultKeymap } from '@codemirror/commands'
import { EditorState, type Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { keymap, runScopeHandlers, type EditorView, type KeyBinding } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { editorDefaultKeymap } from './editor-keymap'

function keyboardView(bindings: readonly KeyBinding[]): EditorView {
  const view = {
    state: EditorState.create({ doc: '# Heading\n\nUntouched', extensions: [markdown(), keymap.of(bindings)] }),
    dispatch: (transaction: Transaction) => { view.state = transaction.state },
  }
  return view as unknown as EditorView
}

function ctrl(key: string, keyCode: number): KeyboardEvent {
  return { key, keyCode, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, stopPropagation: () => undefined } as KeyboardEvent
}

describe('desktop shortcuts pass through CodeMirror', () => {
  it('leaves Ctrl+/ unhandled and Markdown unchanged, unlike the upstream comment shortcut', () => {
    const upstream = keyboardView(defaultKeymap)
    expect(runScopeHandlers(upstream, ctrl('/', 191), 'editor')).toBe(true)
    expect(upstream.state.doc.toString()).toContain('<!--')
    const desktop = keyboardView(editorDefaultKeymap)
    expect(runScopeHandlers(desktop, ctrl('/', 191), 'editor')).toBe(false)
    expect(desktop.state.doc.toString()).toBe('# Heading\n\nUntouched')
  })
  it('does not consume Ctrl+E before the App style-scope command', () => {
    const view = keyboardView(editorDefaultKeymap)
    expect(runScopeHandlers(view, ctrl('e', 69), 'editor')).toBe(false)
    expect(view.state.selection.main.head).toBe(0)
    expect(view.state.doc.toString()).toBe('# Heading\n\nUntouched')
  })
  it('keeps native text navigation such as End available', () => {
    const view = keyboardView(editorDefaultKeymap)
    expect(runScopeHandlers(view, ctrl('End', 35), 'editor')).toBe(true)
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
  })
})
