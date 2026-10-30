import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('长文档代码中的下划线操作不会改源码，末尾已有下划线可正常切换和撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = 'text\n\n'.repeat(1800) + '```js\nconst abc = 1\n```\n\n<u>xyz</u>'
    const file = await openFixture(session, 'long-underline.md', original)
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    const select = (anchor: number, head: number) => editor.evaluate((element, selection) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection }); view.focus() }, { anchor, head })
    const code = original.indexOf('abc')
    await select(code, code + 3)
    await clickNativeMenu(session, '下划线')
    expect(await source()).toBe(original)
    const underline = original.indexOf('xyz')
    await select(underline, underline + 3)
    await clickNativeMenu(session, '下划线')
    await expect.poll(source).toBe(original.replace('<u>xyz</u>', 'xyz'))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
