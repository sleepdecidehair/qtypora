import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('连续反引号的大 HTML 代码使用短围栏并可保存撤销', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'short-fence.md', 'Before\n\n')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const text = '`'.repeat(5600000)
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob(['<pre>' + text + '</pre>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => {
      const doc = (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString()
      return { length: doc.length, start: doc.slice(0, 13), end: doc.slice(-8), bodyCorrect: doc.slice(12, -4) === '`'.repeat(5600000) }
    })
    await expect.poll(content, { timeout: 60000 }).toEqual({ length: 5600016, start: 'Before\n\n~~~\n`', end: '````\n~~~', bodyCorrect: true })
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(async () => (await readFile(file)).length, { timeout: 60000 }).toBe(5600016)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString()), { timeout: 60000 }).toBe('Before\n\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('BOM 和 CRLF 文档在转换后超限时拒绝 HTML 粘贴', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufeffBefore\r\n', 'utf8')
    const file = await openFixture(session, 'bom-crlf-limit.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const text = '汉'.repeat(5592403)
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob(['<p>' + text + '</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 60000 })
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('Before\n')
    expect(await readFile(file)).toEqual(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
