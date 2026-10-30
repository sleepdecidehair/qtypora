import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('macOS Cmd Option C 创建代码围栏，保留旧快捷键和撤销', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 专用快捷键')
  const session = await launchDesktop()
  try {
    const original = 'abc'
    const file = await openFixture(session, 'mac-code.md', original)
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    const select = () => editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 0, head: 3 } }); view.focus() })
    await select()
    await session.page.keyboard.press('Meta+Alt+c')
    await expect.poll(source).toBe('```\nabc\n```\n')
    await session.page.keyboard.press('Meta+z')
    await expect.poll(source).toBe(original)
    await select()
    await session.page.keyboard.press('Meta+Shift+k')
    await expect.poll(source).toBe('```\nabc\n```\n')
    await session.page.keyboard.press('Meta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
