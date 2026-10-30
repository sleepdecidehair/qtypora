import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

for (const [name, source] of [['引用', '> ==foo\n> bar=='], ['列表', '- ==foo\n  bar==']] as const) {
  test(`${name}跨行高亮预览与源码`, async () => {
    const session = await launchDesktop()
    try {
      const file = await openFixture(session, 'mark-container.md', source)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      await session.page.keyboard.press('ControlOrMeta+End')
      await expect(editor.locator('.cm-live-highlight')).toHaveCount(2)
      await expect(editor).not.toContainText('==')
      await editor.evaluate((element, position) => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        view.dispatch({ selection: { anchor: position } }); view.focus()
      }, source.indexOf('bar') + 1)
      await expect(editor).toContainText('==foo')
      await session.page.keyboard.insertText('X')
      await session.page.keyboard.press('ControlOrMeta+z')
      await session.page.keyboard.press('ControlOrMeta+s')
      await expect.poll(() => readFile(file, 'utf8')).toBe(source)
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}
