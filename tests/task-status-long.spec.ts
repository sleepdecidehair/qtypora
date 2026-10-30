import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('长文档反向全选任务状态批量更新并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '- [ ] first\n\n' + 'text\n\n'.repeat(1800) + '- [ ] last'
    const file = await openFixture(session, 'long-task-status.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await editor.evaluate((element, length) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: length, head: 0 } }); view.focus() }, original.length)
    await clickNativeMenu(session, '标记为已完成')
    await expect.poll(source).toBe(original.replace('- [ ] first', '- [x] first').replace('- [ ] last', '- [x] last'))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
