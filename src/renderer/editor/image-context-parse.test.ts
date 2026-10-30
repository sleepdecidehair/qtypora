import { Tree } from '@lezer/common'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { describe, expect, it, vi } from 'vitest'
import { imageContextTarget, sourceContextTarget } from './context-target'

const parserControl = vi.hoisted(() => ({ fail: false }))

// Reproduce a state whose published parse tree is still incomplete under load.
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, syntaxTree: () => Tree.empty, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parserControl.fail ? null : actual.ensureSyntaxTree(...args) }
})

describe('image target with an incomplete published syntax tree', () => {
  it('resolves the reference from a complete bounded parse', () => {
    const doc = '![first][picture] ![second][picture]\n\n[picture]: <a file.png> "caption"'
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    expect(imageContextTarget(state, 'a%20file.png', 0, doc.indexOf('\n'))?.source).toBe('![first][picture]')
  })
  it('fails closed when bounded parsing cannot complete', () => {
    const doc = '```html\n<img src="a.png">\n```'
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    parserControl.fail = true
    try {
      expect(imageContextTarget(state, 'a.png', 0, doc.length)).toBeNull()
      expect(sourceContextTarget(state, doc.indexOf('img')).kind).toBe('editor')
    } finally { parserControl.fail = false }
  })
})
