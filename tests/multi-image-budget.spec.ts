import { test, expect } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('多图片粘贴在写入前检查完整引用预算', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    const original = Buffer.from('\ufeff' + '汉'.repeat(5592398) + '\r\nend', 'utf8')
    const file = await openFixture(session, 'multi-near-limit.md', original)
    const directory = path.join(session.root, 'assets')
    await mkdir(directory)
    await writeFile(path.join(directory, 'one.png'), 'existing')
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.page.locator('.cm-content').evaluate(element => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='), character => character.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([png], 'one.png', { type: 'image/png' }))
      data.items.add(new File([png], 'two.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    })
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 30000 })
    expect(await readdir(directory)).toEqual(['one.png'])
    expect(await readFile(path.join(directory, 'one.png'), 'utf8')).toBe('existing')
    expect(await readFile(file)).toEqual(original)
  } finally { await stopDesktop(session) }
})

test('正常多图片粘贴保留碰撞文件并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'multi-normal.md', 'Before')
    const directory = path.join(session.root, 'assets')
    await mkdir(directory)
    await writeFile(path.join(directory, 'one.png'), 'existing')
    await session.page.keyboard.press('ControlOrMeta+End')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate(element => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='), character => character.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([png], 'one.png', { type: 'image/png' }))
      data.items.add(new File([png], 'two.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    })
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toMatch(/!\[one\]\(assets\/one-[a-f0-9]{8}\.png\)\n\n!\[two\]\(assets\/two\.png\)/)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toMatch(/!\[two\]\(assets\/two\.png\)/)
    expect(await readFile(path.join(directory, 'one.png'), 'utf8')).toBe('existing')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('Before')
  } finally { await stopDesktop(session) }
})
