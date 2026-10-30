import { expect, test } from '@playwright/test'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

for (const offset of [1, 2]) test(`选中表格转义第 ${offset} 半时图片粘贴安全拒绝`, async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| a\\|b | x |\n'
    await openFixture(session, 'table-image-escape.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate((element, offset) => {
      const text = element.firstChild!, selection = window.getSelection()!, range = document.createRange()
      range.setStart(text, offset); range.setEnd(text, offset + 1); selection.removeAllRanges(); selection.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    }, offset)
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect(session.page.getByText('无法安全粘贴图片到此表格选区，请使用插入图片。')).toBeVisible()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

test('完整选择表格转义时可插入图片并撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| a\\|b | x |\n'
    await openFixture(session, 'table-image-escape-full.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate(element => {
      const text = element.firstChild!, selection = window.getSelection()!, range = document.createRange()
      range.setStart(text, 1); range.setEnd(text, 3); selection.removeAllRanges(); selection.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    })
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toMatch(/\| a!\[[^\]]+\]\(assets\/[^)]+\.png\)b \| x \|/)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})
