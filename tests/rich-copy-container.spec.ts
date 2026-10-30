import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

for (const [name, source] of [
  ['引用', '> ```\n> one\n> two\n> ```'],
  ['列表', '- ```\n  one\n  two\n  ```'],
] as const) {
  test(`${name}代码跨行拖选与复制`, async () => {
    const session = await launchDesktop()
    try {
      await openFixture(session, 'container-copy.md', source)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      const from = source.indexOf('one'), to = source.indexOf('two') + 3
      const coords = await editor.evaluate((element, bounds) => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        const a = view.coordsAtPos(bounds.from)!, b = view.coordsAtPos(bounds.to)!
        return { ax: a.left, ay: (a.top + a.bottom) / 2, bx: b.left, by: (b.top + b.bottom) / 2 }
      }, { from, to })
      await session.page.mouse.move(coords.ax + 1, coords.ay)
      await session.page.mouse.down()
      await session.page.mouse.move(coords.bx, coords.by, { steps: 8 })
      await session.page.mouse.up()
      const actual = await editor.evaluate(element => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        return { from: view.state.selection.main.from, to: view.state.selection.main.to, visible: window.getSelection()?.toString() }
      })
      expect(actual.from).toBe(from)
      expect(actual.to).toBe(to)
      await session.page.keyboard.press('ControlOrMeta+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source.slice(from, to))
      const html = await session.app.evaluate(async ({ clipboard }) => {
        for (const item of await clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text()
        return ''
      })
      expect(await session.page.evaluate(value => new DOMParser().parseFromString(value, 'text/html').querySelector('pre')?.textContent, html)).toBe('one\ntwo')
      const patched = await session.page.evaluate(() => window.desktop.patchPreferences({ markdown: { copyPlainMarkdown: false } }))
      expect(patched.ok).toBe(true)
      // The IPC response precedes React and CodeMirror applying the preference.
      // Wait for the observable copy format before checking the next operation.
      await expect.poll(async () => {
        await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
        await session.page.keyboard.press('ControlOrMeta+c')
        return session.app.evaluate(({ clipboard }) => clipboard.readText())
      }).toBe('one\ntwo')
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
      await session.page.keyboard.press('ControlOrMeta+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('one\ntwo')
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
      await session.page.keyboard.press('ControlOrMeta+Shift+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source.slice(from, to))
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}
