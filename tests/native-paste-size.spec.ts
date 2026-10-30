import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('普通纯文本粘贴检查 BOM 与 CRLF 字节并保留正常粘贴', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufeffBefore\r\n', 'utf8')
    const file = await openFixture(session, 'native-paste-size.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('汉'.repeat(5592402)))
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 60000 })
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('Before\n')
    expect(await readFile(file)).toEqual(original)
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('ok'))
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(content).toBe('Before\nok')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before\n')
    await session.page.keyboard.press('ControlOrMeta+/')
    await expect(editor).toHaveAttribute('data-mode', 'source')
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('汉'.repeat(5592402)))
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(content).toBe('Before\n')
    expect(await readFile(file)).toEqual(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
