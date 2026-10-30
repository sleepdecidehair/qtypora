import { EditorState, EditorSelection } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { markdownOptionsFacet } from './markdown-config'
import { taskStatusEdit, type TaskStatusAction } from './task-status'

const parserControl = vi.hoisted(() => ({ incomplete: false }))
vi.mock('@codemirror/language', async importOriginal => {
  const actual = await importOriginal<typeof import('@codemirror/language')>()
  return { ...actual, ensureSyntaxTree: (...args: Parameters<typeof actual.ensureSyntaxTree>) => parserControl.incomplete ? null : actual.ensureSyntaxTree(...args) }
})

function state(doc: string, anchor: number, head = anchor, options: { readOnly?: boolean; strict?: boolean } = {}) {
  return EditorState.create({ doc, selection: EditorSelection.range(anchor, head), extensions: [markdown({ base: markdownLanguage }), history(), EditorState.readOnly.of(!!options.readOnly), markdownOptionsFacet.of({ ...DEFAULT_MARKDOWN_OPTIONS, strictMode: !!options.strict })] })
}
function apply(source: string, anchor: number, head: number, action: TaskStatusAction): string | null {
  const current = state(source, anchor, head)
  const change = taskStatusEdit(current, action)
  return change ? current.update(change).state.doc.toString() : null
}

describe('task status transactions', () => {
  it('marks a single task without rewriting its text and preserves uppercase completed markers', () => {
    const source = '- [ ] **第一项**\n- [X] 第二项'
    expect(apply(source, 8, 8, 'checked')).toBe('- [x] **第一项**\n- [X] 第二项')
    expect(apply(source, source.length, source.length, 'unchecked')).toBe('- [ ] **第一项**\n- [ ] 第二项')
    expect(apply(source, source.length, source.length, 'checked')).toBeNull()
  })
  it('targets the nearest nested task and supports continuation lines', () => {
    const source = '- [ ] 父项\n  - [ ] 子项\n    续行'
    expect(apply(source, source.indexOf('子项'), source.indexOf('子项'), 'checked')).toBe('- [ ] 父项\n  - [x] 子项\n    续行')
    expect(apply(source, source.indexOf('续行'), source.indexOf('续行'), 'checked')).toBe('- [ ] 父项\n  - [x] 子项\n    续行')
  })
  it('changes selected task lines in one transaction and ignores code fence text', () => {
    const source = '- [ ] 第一项\n  - [x] 子项\n\n```\n- [ ] 原样\n```\n\n> - [ ] 最后项'
    expect(apply(source, 0, source.length, 'checked')).toBe('- [x] 第一项\n  - [x] 子项\n\n```\n- [ ] 原样\n```\n\n> - [x] 最后项')
    expect(apply(source, 0, source.length, 'toggle')).toBe('- [x] 第一项\n  - [ ] 子项\n\n```\n- [ ] 原样\n```\n\n> - [x] 最后项')
  })
  it('excludes the next task when selection ends at its line start', () => {
    const source = '- [ ] 一\n- [ ] 二'
    expect(apply(source, 0, source.indexOf('\n') + 1, 'checked')).toBe('- [x] 一\n- [ ] 二')
  })
  it('does not modify read-only, strict Markdown, or non-task text', () => {
    expect(taskStatusEdit(state('- [ ] task', 6, 6, { readOnly: true }), 'checked')).toBeNull()
    expect(taskStatusEdit(state('- [ ] task', 6, 6, { strict: true }), 'checked')).toBeNull()
    expect(taskStatusEdit(state('ordinary [ ] text', 4), 'checked')).toBeNull()
    expect(taskStatusEdit(state('```\n- [ ] task\n```', 7), 'checked')).toBeNull()
  })
  it('undoes the complete multi-task operation in one step', () => {
    const source = '- [ ] 一\n- [ ] 二'
    let current = state(source, 0, source.length)
    current = current.update(taskStatusEdit(current, 'checked')!).state
    const target = { get state() { return current }, dispatch(spec: Parameters<typeof current.update>[0]) { current = current.update(spec).state } }
    expect(undo(target as never)).toBe(true)
    expect(current.doc.toString()).toBe(source)
  })
  it('applies an entire long selection in either direction and undoes it as one change', () => {
    const original = '- [ ] first\n\n' + 'text\n\n'.repeat(1800) + '- [ ] last'
    for (const [anchor, head] of [[0, original.length], [original.length, 0]]) {
      let current = state(original, anchor, head)
      const change = taskStatusEdit(current, 'checked')
      expect(change).not.toBeNull()
      current = current.update(change!).state
      expect(current.doc.toString()).toBe(original.replace('- [ ] first', '- [x] first').replace('- [ ] last', '- [x] last'))
      const target = { get state() { return current }, dispatch(spec: Parameters<typeof current.update>[0]) { current = current.update(spec).state } }
      expect(undo(target as never)).toBe(true)
      expect(current.doc.toString()).toBe(original)
      expect(current.selection.main.anchor).toBe(anchor)
      expect(current.selection.main.head).toBe(head)
    }
  })
  it('refuses the whole selection if the required parse is unavailable', () => {
    const original = '- [ ] first\n\n' + 'text\n\n'.repeat(1800) + '- [ ] last'
    const current = state(original, 0, original.length)
    parserControl.incomplete = true
    try {
      expect(taskStatusEdit(current, 'checked')).toBeNull()
      expect(current.doc.toString()).toBe(original)
    } finally { parserControl.incomplete = false }
  })
})
