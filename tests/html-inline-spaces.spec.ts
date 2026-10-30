import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('HTML 行内格式中的两侧空格和嵌套格式可粘贴并撤销', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'inline-spaces.md', 'Before\n\n')
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob(['<p>one<strong> two </strong>three and<em> four </em>five</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Before\n\none **two** three and *four* five')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before\n\n')
  } finally { await stopDesktop(session) }
})

test('HTML 链接、删除线、高亮和嵌套格式保留文字空格与源码', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'inline-nested.md', 'Before\n\n')
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>A<del> B </del>C<mark> D </mark>E<a href="https://example.com"> F </a>G<strong> <em> H </em> </strong>I</p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Before\n\nA ~~B~~ C ==D== E [F](https://example.com) G ***H*** I')
    await expect(editor).toContainText('A B C D E F G H I')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before\n\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
