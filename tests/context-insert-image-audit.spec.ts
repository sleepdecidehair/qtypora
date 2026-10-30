import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, setContextMenuChoice, setOpenDialog, stopDesktop } from './desktop-helpers'

test('右键插入图片近限额时不写附件', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufeff' + '汉'.repeat(5592398) + '\r\nend', 'utf8')
    const file = await openFixture(session, 'context-insert-near-limit.md', original)
    const source = path.join(session.root, 'example.png')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    await writeFile(source, png)
    await setOpenDialog(session, [source])
    await session.page.keyboard.press('ControlOrMeta+End')
    await setContextMenuChoice(session, 'insert-image')
    await session.page.locator('.cm-line').last().click({ button: 'right', position: { x: 4, y: 8 } })
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 30000 })
    await expect(readFile(path.join(session.root, 'assets', 'example.png'))).rejects.toThrow()
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString().includes('![example](assets/example.png)')), { timeout: 30000 }).toBe(false)
    expect(await readFile(file)).toEqual(original)
  } finally { await stopDesktop(session) }
})

for (const change of ['mode', 'selection'] as const) test(`右键插图选文件期间改变${change === 'mode' ? '模式' : '选区'}不写附件`, async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'context-insert-stale.md', 'Before')
    const source = path.join(session.root, 'example.png')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    await writeFile(source, png)
    await session.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => new Promise(resolve => { Reflect.set(globalThis, 'pendingContextInsertImage', resolve) }) })
    await setContextMenuChoice(session, 'insert-image')
    await session.page.locator('.cm-line').first().click({ button: 'right', position: { x: 4, y: 8 } })
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'pendingContextInsertImage'))).toBe('function')
    if (change === 'mode') await session.page.keyboard.press('ControlOrMeta+/')
    else await session.page.keyboard.press('End')
    await session.app.evaluate((_electron, filename) => {
      const finish = Reflect.get(globalThis, 'pendingContextInsertImage') as (result: Electron.OpenDialogReturnValue) => void
      finish({ canceled: false, filePaths: [filename] })
    }, source)
    await expect(session.page.getByText('文档或选区已变化，未插入图片。请重新选择。')).toBeVisible()
    await expect(readFile(path.join(session.root, 'assets', 'example.png'))).rejects.toThrow()
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('Before')
  } finally { await stopDesktop(session) }
})

test('正常右键插图保留菜单目标并支持撤销', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'context-insert-normal.md', 'Before')
    const source = path.join(session.root, 'example.png')
    await writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await setOpenDialog(session, [source])
    await setContextMenuChoice(session, 'insert-image')
    await session.page.locator('.cm-line').first().click({ button: 'right', position: { x: 1, y: 8 } })
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('![example](assets/example.png)Before')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before')
  } finally { await stopDesktop(session) }
})
