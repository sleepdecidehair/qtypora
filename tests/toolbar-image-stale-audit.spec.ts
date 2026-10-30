import { expect, test } from '@playwright/test'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, setOpenDialog, stopDesktop } from './desktop-helpers'

test('工具栏选图期间光标变化不写入附件', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'toolbar-image.md', 'Before After')
    const source = path.join(session.root, 'example.png')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    await writeFile(source, png)
    const editor = session.page.locator('.cm-content')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 0 } }); view.focus()
    })
    await session.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => new Promise(resolve => { Reflect.set(globalThis, 'pendingImageDialog', resolve) }) })
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'pendingImageDialog'))).toBe('function')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus()
    })
    await session.app.evaluate((_electron, filename) => {
      const finish = Reflect.get(globalThis, 'pendingImageDialog') as (result: Electron.OpenDialogReturnValue) => void
      finish({ canceled: false, filePaths: [filename] })
    }, source)
    await expect(session.page.getByText('文档或选区已变化，未插入图片。请重新选择。')).toBeVisible()
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('Before After')
    await expect(readFile(path.join(session.root, 'assets', 'example.png'))).rejects.toThrow()
  } finally { await stopDesktop(session) }
})

test('取消工具栏选图不修改正文或创建附件', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'toolbar-cancel.md', 'Before')
    await session.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('Before')
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
  } finally { await stopDesktop(session) }
})

test('工具栏选图期间切换控件后不抢回焦点', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'toolbar-focus.md', 'Before')
    const source = path.join(session.root, 'example.png')
    await writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await session.app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => new Promise(resolve => { Reflect.set(globalThis, 'pendingFocusImage', resolve) }) })
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'pendingFocusImage'))).toBe('function')
    await session.page.getByTestId('open-document').focus()
    await expect(session.page.getByTestId('open-document')).toBeFocused()
    await session.app.evaluate((_electron, filename) => {
      const finish = Reflect.get(globalThis, 'pendingFocusImage') as (result: Electron.OpenDialogReturnValue) => void
      finish({ canceled: false, filePaths: [filename] })
    }, source)
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toContain('![example](assets/example.png)')
    await expect(session.page.getByTestId('open-document')).toBeFocused()
  } finally { await stopDesktop(session) }
})

test('工具栏正常选图后焦点回到编辑器且可撤销', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'toolbar-return-focus.md', 'Before')
    const source = path.join(session.root, 'example.png')
    await writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await setOpenDialog(session, [source])
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toContain('![example](assets/example.png)')
    await expect(editor).toBeFocused()
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before')
  } finally { await stopDesktop(session) }
})

test('工具栏图片超出编码限额时不写入附件', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufeff' + '汉'.repeat(5592398) + '\r\nend', 'utf8')
    const file = await openFixture(session, 'toolbar-near-limit.md', original)
    const source = path.join(session.root, 'example.png')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    await writeFile(source, png)
    await setOpenDialog(session, [source])
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 30000 })
    await expect(readFile(path.join(session.root, 'assets', 'example.png'))).rejects.toThrow()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString().endsWith('end')), { timeout: 30000 }).toBe(true)
    expect(await readFile(file)).toEqual(original)
  } finally { await stopDesktop(session) }
})
