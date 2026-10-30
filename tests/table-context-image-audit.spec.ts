import { test, expect } from '@playwright/test'
import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, setContextMenuChoice, setOpenDialog, stopDesktop } from './desktop-helpers'

for (const kind of ['normal', 'virtual'] as const) test(`右键${kind === 'normal' ? '普通格' : '虚拟格'}插图保留单元格位置`, async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first |\n'
    await openFixture(session, 'table-context-image.md', original)
    const image = path.join(session.root, 'x.png')
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await setOpenDialog(session, [image])
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: kind === 'normal' ? '表格第 2 行第 1 列' : '表格第 2 行第 2 列' })
    await cell.click()
    await session.page.keyboard.press('End')
    await cell.evaluate(element => element.addEventListener('contextmenu', () => {
      const selection = window.getSelection(), node = selection?.focusNode
      if (!selection || !node || !element.contains(node)) return
      const range = document.createRange(); range.selectNodeContents(element); range.setEnd(node, selection.focusOffset)
      Reflect.set(window, 'contextImageCaret', range.toString().length)
    }, { capture: true, once: true }))
    await setContextMenuChoice(session, 'insert-image')
    await cell.click({ button: 'right' })
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    if (kind === 'normal') {
      const offset = await session.page.evaluate(() => Reflect.get(window, 'contextImageCaret') as number)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThanOrEqual(5)
      await expect.poll(content).toBe(original.replace('first', `first`.slice(0, offset) + '![x](assets/x.png)' + `first`.slice(offset)))
      expect(await readdir(path.join(session.root, 'assets'))).toEqual(['x.png'])
    } else {
      await expect.poll(content).toBe(original.replace('| first |', '| first | ![x](assets/x.png) |'))
      expect(await readdir(path.join(session.root, 'assets'))).toEqual(['x.png'])
    }
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

test('右键表格选图期间切换单元格不会写附件', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    await openFixture(session, 'table-context-delay.md', original)
    const image = path.join(session.root, 'x.png')
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await session.page.keyboard.press('ControlOrMeta+/')
    const table = session.page.getByTestId('live-table')
    const first = table.getByRole('cell', { name: '表格第 2 行第 1 列' })
    await first.click()
    await session.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => new Promise(resolve => { Reflect.set(globalThis, 'pendingContextTableImage', resolve) }) })
    await setContextMenuChoice(session, 'insert-image')
    await first.click({ button: 'right' })
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'pendingContextTableImage'))).toBe('function')
    await table.getByRole('cell', { name: '表格第 2 行第 2 列' }).click()
    await session.app.evaluate((_electron, filename) => {
      const finish = Reflect.get(globalThis, 'pendingContextTableImage') as (result: Electron.OpenDialogReturnValue) => void
      finish({ canceled: false, filePaths: [filename] })
    }, image)
    await expect(session.page.getByText('文档或选区已变化，未插入图片。请重新选择。')).toBeVisible()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(original)
  } finally { await stopDesktop(session) }
})
