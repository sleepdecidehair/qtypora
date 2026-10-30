import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('Cmd/Ctrl J 滚动到选区，不改变选区和 Markdown 原文', async () => {
  const session = await launchDesktop()
  try {
    const original = Array.from({ length: 120 }, (_, index) => `第 ${index} 段文本`).join('\n\n') + '\n\n末尾目标'
    const file = await openFixture(session, 'jump-selection.md', original)
    const editor = session.page.locator('.cm-content')
    await editor.evaluate((element, position) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.focus(); view.dispatch({ selection: { anchor: position, head: position + 2 } }); view.scrollDOM.scrollTop = 0
    }, original.indexOf('末尾'))
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).scrollDOM.scrollTop)).toBe(0)
    await session.page.keyboard.press('ControlOrMeta+j')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).scrollDOM.scrollTop)).toBeGreaterThan(100)
    expect(await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return { selected: view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to), content: view.state.doc.toString() }
    })).toEqual({ selected: '末尾', content: original })
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
