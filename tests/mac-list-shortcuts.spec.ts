import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('macOS Typora 列表快捷键保留旧绑定并支持撤销', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 专用快捷键')
  const session = await launchDesktop()
  try {
    const original = 'one\ntwo'
    const file = await openFixture(session, 'mac-list.md', original)
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    const caret = async () => editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 1 } }); view.focus() })
    await caret()
    await session.page.keyboard.press('Meta+Alt+o')
    await expect.poll(source).toBe('1. one\ntwo')
    await session.page.keyboard.press('Meta+z')
    await expect.poll(source).toBe(original)
    await caret()
    await session.page.keyboard.press('Meta+Alt+u')
    await expect.poll(source).toBe('- one\ntwo')
    await session.page.keyboard.press('Meta+z')
    await expect.poll(source).toBe(original)
    await caret()
    await session.page.keyboard.press('Meta+Shift+]')
    await expect.poll(source).toBe('- one\ntwo')
    await session.page.keyboard.press('Meta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
