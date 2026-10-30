import { expect, test } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('复制有序列表时 RTF 和语义纯文本保留起始编号与嵌套无序项', async () => {
  const session = await launchDesktop()
  try {
    const source = '4. one\n   - inner\n5. two\n'
    await openFixture(session, 'copy-list.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const patched = await session.page.evaluate(() => window.desktop.patchPreferences({ markdown: { copyPlainMarkdown: false } }))
    expect(patched.ok).toBe(true)
    const editor = session.page.locator('.cm-content')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
      view.focus()
    })
    await expect.poll(async () => {
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('qtypora-test-sentinel'))
      await session.page.keyboard.press('ControlOrMeta+c')
      return session.app.evaluate(({ clipboard }) => clipboard.readText())
    }).toBe('4. one\n• inner\n5. two')
    const rtf = await session.app.evaluate(async ({ clipboard }) => {
      for (const item of await clipboard.read()) if (item.types.includes('text/rtf')) return (await item.getType('text/rtf')).text()
      return ''
    })
    expect(rtf).toContain('4. one')
    expect(rtf).toContain('5. two')
    expect(await editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(source)
  } finally { await stopDesktop(session) }
})
