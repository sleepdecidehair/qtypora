import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Prec, EditorState, type Transaction } from '@codemirror/state'
import { keymap, runScopeHandlers, type EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { guardParagraphBreak } from './paragraph-break-guard'

function pressEnter(doc: string, position: number, mode: 'source' | 'hybrid' = 'hybrid', composing = false) {
  let state = EditorState.create({ doc, selection: { anchor: position }, extensions: [markdown({ base: markdownLanguage }), Prec.highest(keymap.of([{ key: 'Enter', run: view => guardParagraphBreak(view, mode) }]))] })
  const view = {
    get state() { return state },
    composing,
    compositionStarted: composing,
    dispatch(transaction: Transaction) { state = transaction.state },
  } as unknown as EditorView
  const event = { key: 'Enter', keyCode: 13, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, stopPropagation() {} } as KeyboardEvent
  const handled = runScopeHandlers(view, event, 'editor')
  return { handled, source: view.state.doc.toString() }
}

describe('paragraph break guard precedence', () => {
  it('prevents the Markdown continuation keymap from splitting protected entities and graphemes', () => {
    for (const [doc, position] of [['> A&amp;B', 5], ['- A&amp;B', 5], ['> A😀B', 4]] as const) expect(pressEnter(doc, position)).toEqual({ handled: true, source: doc })
  })
  it('leaves ordinary quote and list continuation to the existing high-priority keymap', () => {
    expect(pressEnter('> one', 5)).toEqual({ handled: true, source: '> one\n> ' })
    expect(pressEnter('- one', 5)).toEqual({ handled: true, source: '- one\n- ' })
  })
  it('does not claim input method composition or source mode', () => {
    expect(guardParagraphBreak({ compositionStarted: true } as EditorView, 'hybrid')).toBe(false)
    expect(pressEnter('> A&amp;B', 5, 'source').source).toBe('> A&a\n> mp;B')
    const code = EditorState.create({ doc: '```\nA&amp;B\n```', selection: { anchor: 7 }, extensions: [markdown({ base: markdownLanguage })] })
    expect(guardParagraphBreak({ compositionStarted: false, state: code } as EditorView, 'hybrid')).toBe(false)
  })
})
