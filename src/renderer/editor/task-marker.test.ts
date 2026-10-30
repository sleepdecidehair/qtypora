import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { isTaskMarker } from './task-marker'

const state = (doc: string, strict = false) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, strictMode: strict })] })

describe('task marker detection', () => {
  it('accepts parsed bullets, numbers, nested tasks and quoted tasks', () => {
    for (const doc of ['- [ ] task', '+ [X] task', '1. [x] task', '> - [ ] task', '- parent\n  - [x] child']) {
      const editor = state(doc)
      expect(isTaskMarker(editor, doc.indexOf('['))).toBe(true)
    }
  })
  it('rejects code, malformed markers, unparsed source and strict mode', () => {
    for (const doc of ['    - [ ] code', '```\n- [ ] code', '> ```\n> - [ ] code\n> ```', '- [ ]not a task']) {
      const editor = state(doc)
      expect(isTaskMarker(editor, doc.indexOf('['))).toBe(false)
    }
    const doc = '- [ ] task'
    expect(isTaskMarker(state(doc, true), doc.indexOf('['))).toBe(false)
    expect(isTaskMarker(EditorState.create({ doc }), doc.indexOf('['))).toBe(false)
  })
})
