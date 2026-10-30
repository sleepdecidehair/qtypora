import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('Cmd/Ctrl L 在实时预览选择当前句，在源码模式选择当前行', async () => {
  const session = await launchDesktop()
  try {
    const original = 'First sentence. Second sentence.\nNext line.'
    const file = await openFixture(session, 'select-line-shortcut.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const selected = () => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      const selection = view.state.selection.main
      return view.state.doc.sliceString(selection.from, selection.to)
    })
    await editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 4 } }); view.focus() })
    await session.page.keyboard.press('ControlOrMeta+l')
    await expect.poll(selected).toBe('First sentence. ')
    await session.page.keyboard.press('ControlOrMeta+/')
    await editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 4 } }); view.focus() })
    await session.page.keyboard.press('ControlOrMeta+l')
    await expect.poll(selected).toBe('First sentence. Second sentence.')
    expect(await readFile(file, 'utf8')).toBe(original)
    await session.page.getByTestId('preferences-button').click()
    const search = session.page.getByLabel('搜索设置')
    await search.fill('原设置')
    await session.page.keyboard.press('ControlOrMeta+l')
    await expect(search).toBeFocused()
    expect(await selected()).toBe('First sentence. Second sentence.')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('Cmd/Ctrl L 在实时预览表格选择当前行并保留原文', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| 一 | 1 |\n| 二 | 2 |\n'
    const file = await openFixture(session, 'select-table-line.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.getByTestId('live-table').locator('tbody td').filter({ hasText: '二' }).click()
    await session.page.keyboard.press('ControlOrMeta+l')
    await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to)
    })).toBe('| 二 | 2 |')
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
