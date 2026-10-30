import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('Cmd/Ctrl Shift Backspace 删除当前句并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = 'First sentence. Second sentence.'
    const file = await openFixture(session, 'sentence-shortcut.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 4 } }); view.focus() })
    await session.page.keyboard.press('ControlOrMeta+Shift+Backspace')
    await expect.poll(source).toBe('Second sentence.')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('Cmd/Ctrl Shift Backspace 在表格单元格删除该行并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| 一 | 1 |\n| 二 | 2 |\n| 三 | 3 |\n'
    const file = await openFixture(session, 'table-delete-shortcut.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await session.page.getByTestId('live-table').locator('tbody td').filter({ hasText: '二' }).click()
    await session.page.keyboard.press('ControlOrMeta+Shift+Backspace')
    await expect.poll(source).toBe(original.replace('| 二 | 2 |\n', ''))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    await session.page.getByTestId('preferences-button').click()
    const search = session.page.getByLabel('搜索设置')
    await search.fill('外观')
    await session.page.keyboard.press('ControlOrMeta+Shift+Backspace')
    await expect(search).toBeFocused()
    expect(await source()).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
