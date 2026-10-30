import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('Cmd/Ctrl Shift D 删除当前词并可撤销，不作用于设置输入', async () => {
  const session = await launchDesktop()
  try {
    const original = 'alpha bravo charlie'
    const file = await openFixture(session, 'delete-word-shortcut.md', original)
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 8 } }); view.focus() })
    await session.page.keyboard.press('ControlOrMeta+Shift+d')
    await expect.poll(source).toBe('alpha  charlie')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    await session.page.getByTestId('preferences-button').click()
    const search = session.page.getByLabel('搜索设置')
    await search.fill('外观')
    await session.page.keyboard.press('ControlOrMeta+Shift+d')
    await expect(search).toBeFocused()
    expect(await source()).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
