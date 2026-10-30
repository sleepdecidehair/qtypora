import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('长文档图片批量处理覆盖正文与引用定义并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '![first](first.png)\n\n' + 'text\n\n'.repeat(1800) + '![last][photo]\n\n[photo]: last.png'
    const file = await openFixture(session, 'images-long.md', original)
    await session.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('qtypora:uploadImages')
      ipcMain.handle('qtypora:uploadImages', (_event, request: { sources: string[] }) => {
        Reflect.set(globalThis, 'qtyporaImageSources', request.sources)
        return { ok: true, data: { replacements: request.sources.map((source, index) => ({ source, url: `https://example.com/${index}.png` })) } }
      })
    })
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await clickNativeMenu(session, '上传文档中的本地图片')
    const expected = original.replace('first.png', 'https://example.com/0.png').replace('last.png', 'https://example.com/1.png')
    await expect.poll(source).toBe(expected)
    expect(await session.app.evaluate(() => Reflect.get(globalThis, 'qtyporaImageSources'))).toEqual(['first.png', 'last.png'])
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
