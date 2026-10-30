import { test, expect } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, setContextMenuChoice, stopDesktop } from './desktop-helpers'

test('右键图片粘贴接近文件限额的实际资源行为', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufeff' + '汉'.repeat(5592398) + '\r\nend', 'utf8')
    expect(original.length).toBe(16777202)
    const file = await openFixture(session, 'near-limit-image.md', original)
    const directory = path.join(session.root, 'assets')
    await mkdir(directory)
    await writeFile(path.join(directory, 'clipboard-1.png'), 'existing')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await setContextMenuChoice(session, 'paste')
    await session.page.locator('.cm-line').last().click({ button: 'right', position: { x: 4, y: 8 } })
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 60000 })
    const names = await readdir(directory)
    expect(names).toEqual(['clipboard-1.png'])
    expect(await readFile(path.join(directory, 'clipboard-1.png'), 'utf8')).toBe('existing')
    expect(await readFile(file)).toEqual(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('右键粘贴普通图片插入引用且不覆盖已有文件', async () => {
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'normal-image.md', 'before\n')
    const directory = path.join(session.root, 'assets')
    await mkdir(directory)
    await writeFile(path.join(directory, 'clipboard-1.png'), 'existing')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const png = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
    })
    await setContextMenuChoice(session, 'paste')
    await session.page.locator('.cm-line').last().click({ button: 'right', position: { x: 4, y: 8 } })
    await expect.poll(async () => (await readdir(directory)).length).toBe(2)
    await expect(session.page.getByRole('img', { name: 'clipboard-1', exact: true })).toBeVisible()
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toMatch(/!\[clipboard-1\]\(assets\/clipboard-1-[a-f0-9]{8}\.png\)/)
    expect(await readFile(path.join(directory, 'clipboard-1.png'), 'utf8')).toBe('existing')
    await session.page.keyboard.press('ControlOrMeta+z')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe('before\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

for (const change of ['selection', 'mode'] as const) test(`右键读取图片期间改变${change === 'mode' ? '模式' : '选区'}不创建附件`, async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'delayed-image.md', 'Before')
    await session.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('qtypora:readClipboard')
      ipcMain.handle('qtypora:readClipboard', () => new Promise(resolve => { Reflect.set(globalThis, 'qtyporaTestImageClipboardResolve', resolve) }))
    })
    await setContextMenuChoice(session, 'paste')
    await session.page.locator('.cm-line').first().click({ button: 'right', position: { x: 10, y: 8 } })
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'qtyporaTestImageClipboardResolve'))).toBe('function')
    if (change === 'mode') await session.page.keyboard.press('ControlOrMeta+/')
    else await session.page.keyboard.press('End')
    await session.app.evaluate(({ nativeImage }) => {
      const resolve = Reflect.get(globalThis, 'qtyporaTestImageClipboardResolve') as (value: unknown) => void
      const bytes = nativeImage.createFromBitmap(Buffer.from([30, 160, 230, 255]), { width: 1, height: 1 }).toPNG()
      resolve({ ok: true, data: { text: '', images: [{ name: 'clipboard-1.png', bytes }] } })
      Reflect.deleteProperty(globalThis, 'qtyporaTestImageClipboardResolve')
    })
    await expect(session.page.getByText('文档或选区已变化，未粘贴文本。')).toBeVisible()
    await expect(readdir(path.join(session.root, 'assets'))).rejects.toThrow()
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
