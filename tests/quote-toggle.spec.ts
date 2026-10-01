import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  if (!session) return
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

const source = () => session.page.locator('.cm-content').evaluate(element => {
  const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
  return view.state.doc.toString()
})

for (const mode of ['source', 'hybrid'] as const) {
  test(`${mode} 视图中引用按钮可再次取消，支持多行、空行、快捷键和撤销重做`, async () => {
    const original = '正文 **粗体** 与 [链接](https://example.com)\n\n- [x] 事项\n\n末尾\n'
    const file = await openFixture(session, `quote-${mode}.md`, original)
    if (mode === 'hybrid') await session.page.keyboard.press('Control+/')
    const editor = session.page.locator('.cm-content')
    const quote = session.page.getByRole('button', { name: '引用', exact: true })
    await editor.click()
    await session.page.keyboard.press('Control+Home')
    await quote.click()
    await expect.poll(source).toBe('> ' + original)
    if (mode === 'hybrid') await expect(editor.locator('.cm-live-quote')).toHaveCount(1)
    await quote.click()
    await expect.poll(source).toBe(original)
    if (mode === 'hybrid') await expect(editor.locator('.cm-live-quote')).toHaveCount(0)

    await session.page.keyboard.press('Control+a')
    await quote.click()
    const quoted = original.slice(0, -1).split('\n').map(line => '> ' + line).join('\n') + '\n'
    await expect.poll(source).toBe(quoted)
    await quote.click()
    await expect.poll(source).toBe(original)

    await session.page.keyboard.press('Control+End')
    await quote.click()
    await expect.poll(source).toBe(original + '> ')
    await quote.click()
    await session.page.keyboard.insertText('普通段落')
    await expect.poll(source).toBe(original + '普通段落')
    await session.page.keyboard.press('Control+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original + '普通段落')

    const existing = '> 引用 **格式**\n\n后续内容\n'
    await openFixture(session, `existing-quote-${mode}.md`, existing)
    await editor.click()
    await session.page.keyboard.press('Control+Home')
    await session.page.keyboard.press('Control+Shift+q')
    await expect.poll(source).toBe(existing.slice(2))
    await session.page.keyboard.press('Control+z')
    await expect.poll(source).toBe(existing)
    await session.page.keyboard.press('Control+y')
    await expect.poll(source).toBe(existing.slice(2))
    await session.page.keyboard.press('Control+s')

    await openFixture(session, `empty-first-line-${mode}.md`, '\n后续内容\n')
    await editor.click()
    await session.page.keyboard.press('Control+Home')
    await quote.click()
    await expect.poll(source).toBe('> \n后续内容\n')
    await quote.click()
    await expect.poll(source).toBe('\n后续内容\n')
  })
}
