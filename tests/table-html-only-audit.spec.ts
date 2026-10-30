import { expect, test } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('表格选区粘贴仅 HTML 段落并一次撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    await openFixture(session, 'table-html-only.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate(element => {
      const selection = window.getSelection()!, range = document.createRange()
      range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    })
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/html': new Blob(['<p>HTML text</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe(original.replace('first', 'HTML text'))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

for (const sample of [
  { name: '行内格式、竖线和换行', html: '<p><strong>Bold</strong> | next<br>line</p>', expected: '**Bold** \\| next<br>line' },
  { name: '行内代码换行', html: '<p><code>one<br>two</code></p>', expected: '`one`<br>`two`' },
  { name: '多段落和行内格式', html: '<p>first <strong>bold</strong></p><p>second | value</p>', expected: 'first **bold**<br><br>second \\| value' },
  { name: '段落之间的空段落', html: '<p>first</p><p></p><p>last</p>', expected: 'first<br><br><br><br>last' },
]) test(`表格 HTML-only 粘贴保留${sample.name}`, async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    await openFixture(session, 'table-html-inline.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate(element => {
      const selection = window.getSelection()!, range = document.createRange()
      range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    })
    await session.app.evaluate(async ({ clipboard, ClipboardItem }, html) => {
      await clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })])
    }, sample.html)
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe(original.replace('first', sample.expected))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

for (const html of ['<table><tr><td>unsafe structure</td></tr></table>', '<p>text<img src="https://example.invalid/image.png"></p>', '<p><a href="javascript:alert(1)">bad</a></p>', '<p>x</p>'.repeat(501)]) test(`表格 HTML-only 不支持结构时保留选区 ${html.slice(0, 15)}`, async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    await openFixture(session, 'table-html-unsupported.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate(element => {
      const selection = window.getSelection()!, range = document.createRange()
      range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    })
    await session.app.evaluate(async ({ clipboard, ClipboardItem }, value) => {
      await clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })])
    }, html)
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect(session.page.getByText('无法安全粘贴 HTML 到此表格选区。')).toBeVisible()
    await expect.poll(() => cell.evaluate(() => window.getSelection()?.toString())).toBe('first')
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(original)
  } finally { await stopDesktop(session) }
})
