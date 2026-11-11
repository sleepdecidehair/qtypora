import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, redoKey, stopDesktop } from './desktop-helpers'

test('空光标不自动补齐扩展标记，选中文本包裹可撤销、重做并保存', async () => {
  const session = await launchDesktop()
  try {
    const original = '前置 highlight 后置\n\n\n\n'
    const file = await openFixture(session, 'typora-auto-pair.md', original)
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      const from = view.state.doc.toString().indexOf('highlight')
      view.dispatch({ selection: { anchor: from, head: from + 'highlight'.length } })
      view.focus()
    })
    await session.page.keyboard.insertText('=')
    const wrapped = '前置 ==highlight== 后置\n\n\n\n'
    await expect.poll(source).toBe(wrapped)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    await session.page.keyboard.press(redoKey)
    await expect.poll(source).toBe(wrapped)

    const typeOnLine = async (lineNumber: number, value: string) => {
      await editor.evaluate((element, line) => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        view.dispatch({ selection: { anchor: view.state.doc.line(line).from } })
        view.focus()
      }, lineNumber)
      for (const character of value) await session.page.keyboard.insertText(character)
    }
    await typeOnLine(2, '~')
    await typeOnLine(3, '^')
    await typeOnLine(4, '==')
    const expected = '前置 ==highlight== 后置\n~\n^\n==\n'
    await expect.poll(source).toBe(expected)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(expected)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
