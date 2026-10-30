import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('Cmd/Ctrl Shift C 复制选中 Markdown 源文，不影响文档和设置输入', async () => {
  const session = await launchDesktop()
  try {
    const original = 'one **bold** tail'
    const file = await openFixture(session, 'copy-shortcut.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 4, head: 12 } }); view.focus() })
    await session.page.keyboard.press('ControlOrMeta+Shift+c')
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('**bold**')
    expect(await readFile(file, 'utf8')).toBe(original)
    await session.page.getByTestId('preferences-button').click()
    const search = session.page.getByLabel('搜索设置')
    await search.fill('外观')
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('保留剪贴板'))
    await session.page.keyboard.press('ControlOrMeta+Shift+c')
    await expect(search).toBeFocused()
    expect(await session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('保留剪贴板')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
