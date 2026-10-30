import { test, expect } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

async function clipboardImage(session: Awaited<ReturnType<typeof launchDesktop>>) {
  await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  })
}

test('键盘图片粘贴按 BOM 和 CRLF 预算拒绝且不写附件', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufeff' + '汉'.repeat(5592398) + '\r\nend', 'utf8')
    const file = await openFixture(session, 'near-limit-keyboard.md', original)
    const directory = path.join(session.root, 'assets')
    await mkdir(directory)
    await writeFile(path.join(directory, 'clipboard-1.png'), 'existing')
    await session.page.keyboard.press('ControlOrMeta+End')
    await clipboardImage(session)
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 30000 })
    expect(await readdir(directory)).toEqual(['clipboard-1.png'])
    expect(await readFile(path.join(directory, 'clipboard-1.png'), 'utf8')).toBe('existing')
    expect(await readFile(file)).toEqual(original)
  } finally { await stopDesktop(session) }
})

for (const change of ['selection', 'mode'] as const) test(`读取图片期间改变${change === 'selection' ? '选区' : '模式'}不创建附件`, async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'delayed-keyboard-image.md', 'Before')
    await session.page.evaluate(() => {
      const original = File.prototype.arrayBuffer
      File.prototype.arrayBuffer = function () {
        return new Promise<ArrayBuffer>(resolve => { Reflect.set(window, 'resolveImageBytes', () => { void original.call(this).then(resolve) }) })
      }
    })
    await clipboardImage(session)
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(() => session.page.evaluate(() => typeof Reflect.get(window, 'resolveImageBytes'))).toBe('function')
    if (change === 'selection') await session.page.keyboard.press('End')
    else await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.evaluate(() => { Reflect.get(window, 'resolveImageBytes')() })
    await expect(session.page.getByText('文档或选区已变化，未插入图片。请重新粘贴或拖放。')).toBeVisible()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
  } finally { await stopDesktop(session) }
})

test('键盘图片粘贴等待期间切换控件不抢回焦点', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'delayed-keyboard-focus.md', 'Before')
    await session.page.evaluate(() => {
      const original = File.prototype.arrayBuffer
      File.prototype.arrayBuffer = function () {
        return new Promise<ArrayBuffer>(resolve => { Reflect.set(window, 'resolveFocusImageBytes', () => { void original.call(this).then(resolve) }) })
      }
    })
    await clipboardImage(session)
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(() => session.page.evaluate(() => typeof Reflect.get(window, 'resolveFocusImageBytes'))).toBe('function')
    await session.page.getByTestId('open-document').focus()
    await expect(session.page.getByTestId('open-document')).toBeFocused()
    await session.page.evaluate(() => { Reflect.get(window, 'resolveFocusImageBytes')() })
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toMatch(/!\[[^\]]+\]\(assets\/[^)]+\.png\)/)
    await expect(session.page.getByTestId('open-document')).toBeFocused()
  } finally { await stopDesktop(session) }
})

test('键盘正常粘贴图片保持编辑器焦点并可撤销', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'keyboard-image-focus.md', 'Before')
    await clipboardImage(session)
    const editor = session.page.locator('.cm-content')
    await editor.focus()
    await session.page.keyboard.press('ControlOrMeta+v')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toMatch(/!\[[^\]]+\]\(assets\/[^)]+\.png\)/)
    await expect(editor).toBeFocused()
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before')
  } finally { await stopDesktop(session) }
})
