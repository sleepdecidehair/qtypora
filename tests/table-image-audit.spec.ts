import { expect, test } from '@playwright/test'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, setOpenDialog, stopDesktop } from './desktop-helpers'

test('实时表格单元格中工具栏插入多张图片保留表格', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    const file = await openFixture(session, 'table-image.md', original)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
    const files = ['one.png', 'two.png', 'three.png'].map(name => path.join(session.root, name))
    for (const source of files) await writeFile(source, png)
    await setOpenDialog(session, files)
    await session.page.keyboard.press('ControlOrMeta+/')
    const table = session.page.getByTestId('live-table')
    const cell = table.getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await session.page.keyboard.press('End')
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toContain('![one](assets/one.png)<br><br>![two](assets/two.png)<br><br>![three](assets/three.png)')
    expect(await readdir(path.join(session.root, 'assets'))).toEqual(['one.png', 'three.png', 'two.png'])
    await expect(table).toBeVisible()
    expect(await readFile(file, 'utf8')).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

test('单张图片替换表格单元格选区并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    await openFixture(session, 'table-one-image.md', original)
    const source = path.join(session.root, 'one.png')
    await writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await setOpenDialog(session, [source])
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate(element => {
      const selection = window.getSelection()!, range = document.createRange()
      range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    })
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe(original.replace('first', '![one](assets/one.png)'))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

test('跨表格单元格选区插图会拒绝且不创建附件', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    await openFixture(session, 'table-cross-image.md', original)
    const source = path.join(session.root, 'one.png')
    await writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await setOpenDialog(session, [source])
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate((element, text) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: text.indexOf('first'), head: text.indexOf('second') + 6 } }); view.focus()
    }, original)
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    await expect(session.page.getByText('无法安全插入图片，请调整选区后重试。')).toBeVisible()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(original)
  } finally { await stopDesktop(session) }
})

test('表格单元格选区粘贴图片后保留表格并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    await openFixture(session, 'table-clipboard-image.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await cell.evaluate(element => {
      const selection = window.getSelection()!, range = document.createRange()
      range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    })
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toMatch(/^\| A \| B \|\n\| --- \| --- \|\n\| !\[[^\]]+\]\(assets\/[^)]+\.png\) \| second \|\n$/)
    expect(await readdir(path.join(session.root, 'assets'))).toHaveLength(1)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

test('读取图片期间表格选区变化不会写附件', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| first | second |\n'
    await openFixture(session, 'table-paste-delay.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' })
    await cell.click()
    await session.page.evaluate(() => {
      const originalRead = File.prototype.arrayBuffer
      File.prototype.arrayBuffer = function () { return new Promise(resolve => { Reflect.set(window, 'finishTableImageRead', () => { void originalRead.call(this).then(resolve) }) }) }
    })
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(() => session.page.evaluate(() => typeof Reflect.get(window, 'finishTableImageRead'))).toBe('function')
    await session.page.keyboard.press('End')
    await session.page.evaluate(() => { Reflect.get(window, 'finishTableImageRead')() })
    await expect(session.page.getByText('文档或表格选区已变化，未粘贴图片。')).toBeVisible()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(original)
  } finally { await stopDesktop(session) }
})

test('虚拟补出的单元格粘贴图片会补齐并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| only |\n'
    await openFixture(session, 'table-missing-paste.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const cell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 2 列' })
    await cell.click()
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toMatch(/\| only \| !\[[^\]]+\]\(assets\/[^)]+\.png\) \|\n$/)
    expect(await readdir(path.join(session.root, 'assets'))).toHaveLength(1)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

test('虚拟格粘贴图片保留 BOM 和 CRLF 保存格式', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| only |\n'
    const file = await openFixture(session, 'table-missing-crlf.md', Buffer.from('\ufeff' + original.replaceAll('\n', '\r\n'), 'utf8'))
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 2 列' }).click()
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toMatch(/\| only \| !\[[^\]]+\]\(assets\/[^)]+\.png\) \|\n$/)
    const expected = await content()
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file)).toEqual(Buffer.from('\ufeff' + expected.replaceAll('\n', '\r\n'), 'utf8'))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

test('虚拟格读取图片期间焦点变更不会写附件', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| only |\n'
    await openFixture(session, 'table-missing-delay.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const table = session.page.getByTestId('live-table')
    await table.getByRole('cell', { name: '表格第 2 行第 2 列' }).click()
    await session.page.evaluate(() => {
      const originalRead = File.prototype.arrayBuffer
      File.prototype.arrayBuffer = function () { return new Promise(resolve => { Reflect.set(window, 'finishVirtualImageRead', () => { void originalRead.call(this).then(resolve) }) }) }
    })
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(() => session.page.evaluate(() => typeof Reflect.get(window, 'finishVirtualImageRead'))).toBe('function')
    await table.getByRole('cell', { name: '表格第 2 行第 1 列' }).click()
    await session.page.evaluate(() => { Reflect.get(window, 'finishVirtualImageRead')() })
    await expect(session.page.getByText('文档或表格选区已变化，未粘贴图片。')).toBeVisible()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(original)
  } finally { await stopDesktop(session) }
})

test('已有空表格单元格可直接粘贴图片并撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n|  | x |\n'
    await openFixture(session, 'table-empty-paste.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' }).click()
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toMatch(/\| !\[[^\]]+\]\(assets\/[^)]+\.png\) \| x \|/)
    expect(await readdir(path.join(session.root, 'assets'))).toHaveLength(1)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})

test('已有空表格单元格可通过工具栏插图并撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n|  | x |\n'
    await openFixture(session, 'table-empty-chooser.md', original)
    const source = path.join(session.root, 'one.png')
    await writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'))
    await setOpenDialog(session, [source])
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 1 列' }).click()
    await session.page.getByRole('button', { name: '插入图片', exact: true }).click()
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe(original.replace('|  | x |', '| ![one](assets/one.png) | x |'))
    expect(await readdir(path.join(session.root, 'assets'))).toEqual(['one.png'])
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
  } finally { await stopDesktop(session) }
})
