import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('长文档代码围栏内输入单个星号不触发 Markdown 自动配对', async () => {
  const session = await launchDesktop()
  try {
    const original = 'text\n\n'.repeat(1800) + '```js\nconst x = '
    const file = await openFixture(session, 'long-code-input.md', original)
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await editor.evaluate((element, anchor) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor }, scrollIntoView: true }); view.focus() }, original.length)
    await session.page.keyboard.insertText('*')
    await expect.poll(source).toBe(original + '*')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
