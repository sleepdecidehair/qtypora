import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('缩进代码的缩进区不应被 HTML 粘贴破坏', async () => {
  const session = await launchDesktop()
  try {
    const source = '    first\n    last\n\nAfter'
    await openFixture(session, 'indent-paste.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 11 } }); view.focus()
    })
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['X'], { type: 'text/plain' }), 'text/html': new Blob(['<b>X</b>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect(session.page.getByText('无法安全粘贴到该代码位置，请调整选区或内容后重试。')).toBeVisible()
    await expect.poll(content).toBe(source)
    await editor.evaluate((element, position) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: position } }); view.focus()
    }, source.indexOf('last'))
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(content).toBe('    first\n    Xlast\n\nAfter')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(source)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
