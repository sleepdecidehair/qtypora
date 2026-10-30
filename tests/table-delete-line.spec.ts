import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('在表格单元格删除当前行并撤销保留 Markdown', async () => {
  const session = await launchDesktop()
  try {
    const original = '前文\n\n| A | B |\n| --- | --- |\n| 一 | 1 |\n| 二 | 2 |\n| 三 | 3 |\n\n后文\n'
    const file = await openFixture(session, 'table-delete-line.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await session.page.getByTestId('live-table').locator('tbody td').filter({ hasText: '二' }).click()
    await clickNativeMenu(session, '删除当前行或句')
    await expect.poll(source).toBe(original.replace('| 二 | 2 |\n', ''))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
