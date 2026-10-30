import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('实时预览列表 Shift Enter 延续当前项并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '12. first'
    const file = await openFixture(session, 'list-soft-break.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await editor.evaluate((element, anchor) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor } }); view.focus() }, original.length)
    await session.page.keyboard.press('Shift+Enter')
    await expect.poll(source).toBe('12. first\n    ')
    await session.page.keyboard.insertText('# heading')
    await expect.poll(source).toBe('12. first\n    # heading')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe('12. first\n    ')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

for (const [name, original, indentation] of [['unchecked', '- [ ] task', '  '], ['checked', '- [x] task', '  '], ['nested', '- parent\n  - child', '    ']] as const) {
  test(`实时预览 ${name} 列表项软换行保留层级和原文`, async () => {
    const session = await launchDesktop()
    try {
      const file = await openFixture(session, `${name}-soft-break.md`, original)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
      await editor.evaluate((element, anchor) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor } }); view.focus() }, original.length)
      await session.page.keyboard.press('Shift+Enter')
      await expect.poll(source).toBe(original + '\n' + indentation)
      await session.page.keyboard.insertText('# heading')
      await expect.poll(source).toBe(original + '\n' + indentation + '# heading')
      await session.page.keyboard.press('ControlOrMeta+z')
      await expect.poll(source).toBe(original + '\n' + indentation)
      await session.page.keyboard.press('ControlOrMeta+z')
      await expect.poll(source).toBe(original)
      expect(await readFile(file, 'utf8')).toBe(original)
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}
