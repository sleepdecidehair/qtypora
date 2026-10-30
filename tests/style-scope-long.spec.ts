import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, stopDesktop, openFixture, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => { if (session) await stopDesktop(session) })

test('长文档选中当前样式后替换只改变样式正文并可撤销', async () => {
  const prefix = 'text\n\n'.repeat(1800)
  const source = prefix + 'before **hello** after'
  const filePath = await openFixture(session, 'style-scope-long.md', source)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await editor.evaluate((element, position) => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true })
    view.focus()
  }, prefix.length + 11)
  await session.page.keyboard.press('ControlOrMeta+e')
  await expect.poll(() => editor.evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
  })).toBe('hello')
  await session.page.keyboard.insertText('world')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(filePath, 'utf8')).toBe(prefix + 'before **world** after')
  await session.page.keyboard.press('ControlOrMeta+z')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(filePath, 'utf8')).toBe(source)
  expect(session.errors).toEqual([])
})
