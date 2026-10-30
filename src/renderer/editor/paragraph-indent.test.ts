import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { paragraphIndentLines } from './paragraph-indent'

describe('first-line paragraph indentation', () => {
  it('targets only the first line of top-level paragraphs', () => {
    const doc = 'first line\ncontinued\n\n# heading\n\n- list item\n\n> quote\n\n```js\ncode\n```\n\nlast paragraph'
    const state = EditorState.create({ doc, extensions: [markdown()] })
    expect(paragraphIndentLines(state).map(pos => state.doc.lineAt(pos).text)).toEqual(['first line', '> quote', 'last paragraph'])
  })
  it('does not indent quoted paragraphs inside a list item', () => {
    const doc = '- item\n  > quote\n\n> outside\n> continued'
    const state = EditorState.create({ doc, extensions: [markdown()] })
    expect(paragraphIndentLines(state).map(pos => state.doc.lineAt(pos).text)).toEqual(['> outside'])
  })
})
