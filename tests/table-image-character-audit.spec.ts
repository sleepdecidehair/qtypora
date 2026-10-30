import { expect, test } from '@playwright/test'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('程序选择表格实体内部时图片粘贴安全拒绝', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| a&amp;b | x |\n'
    await openFixture(session, 'table-image-entity.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate(element => {
      const text = element.firstChild!, selection = window.getSelection()!, range = document.createRange()
      range.setStart(text, 2); range.setEnd(text, 5); selection.removeAllRanges(); selection.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    })
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

test('键盘选择表格实体内部时图片粘贴安全拒绝', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| a&amp;b | x |\n'
    await openFixture(session, 'table-image-entity-keys.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await session.page.keyboard.press('Home')
    await session.page.keyboard.press('ArrowRight')
    await session.page.keyboard.press('ArrowRight')
    for (let i = 0; i < 3; i++) await session.page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => cell.evaluate(() => window.getSelection()?.toString())).toBe('amp')
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

test('程序选择表格字素内部时图片粘贴安全拒绝', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| a👩‍💻b | x |\n'
    await openFixture(session, 'table-image-grapheme.md', original)
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
    await expect(session.page.getByText('无法安全粘贴图片到此表格选区，请使用插入图片。')).toBeVisible()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})
