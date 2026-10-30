import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('纯文本粘贴必须考虑已有内容和文件编码', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const bytes = Buffer.from('\ufeffBefore\r\n', 'utf8')
    const file = await openFixture(session, 'plain-size.md', bytes)
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('汉'.repeat(5592402)))
    await session.page.keyboard.press('ControlOrMeta+Shift+v')
    const editor = session.page.locator('.cm-content')
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 60000 })
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Before\n')
    expect(await readFile(file)).toEqual(bytes)
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('ok'))
    await session.page.keyboard.press('ControlOrMeta+Shift+v')
    await expect.poll(content).toBe('Before\nok')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before\n')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

for (const change of ['document', 'mode'] as const) {
  test(`异步纯文本粘贴期间${change === 'mode' ? '模式' : '文档'}变化时拒绝过期结果`, async () => {
    const session = await launchDesktop()
    try {
      await openFixture(session, 'delayed-plain-paste.md', 'Before')
      await session.page.keyboard.press('ControlOrMeta+/')
      await session.page.keyboard.press('ControlOrMeta+End')
      await session.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('qtypora:readClipboardText')
        ipcMain.handle('qtypora:readClipboardText', () => new Promise(resolve => { Reflect.set(globalThis, 'qtyporaTestResolvePlainPaste', resolve) }))
      })
      await session.page.keyboard.press('ControlOrMeta+Shift+v')
      await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'qtyporaTestResolvePlainPaste'))).toBe('function')
      if (change === 'mode') await session.page.keyboard.press('ControlOrMeta+/')
      else await session.page.keyboard.insertText('!')
      await session.app.evaluate(() => {
        const resolve = Reflect.get(globalThis, 'qtyporaTestResolvePlainPaste') as (result: { ok: true; data: string }) => void
        resolve({ ok: true, data: 'STALE' })
        Reflect.deleteProperty(globalThis, 'qtyporaTestResolvePlainPaste')
      })
      await expect(session.page.getByText('文档或选区已变化，未粘贴文本。')).toBeVisible()
      const editor = session.page.locator('.cm-content')
      await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(change === 'mode' ? 'Before' : 'Before!')
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}
