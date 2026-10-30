import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

for (const [name, source] of [
  ['引用', '> Intro\n>\n> ```\n> **hello**\n> ```\n\nAfter'],
  ['列表', '- Intro\n\n  ```\n  **hello**\n  ```\n\nAfter'],
] as const) for (const reverse of [false, true]) {
  test(`${name}代码跨块${reverse ? '反向' : '正向'}拖选复制`, async () => {
    const session = await launchDesktop()
    try {
      await openFixture(session, 'cross-container.md', source)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      const from = source.indexOf('Intro'), to = source.indexOf('hello') + 5
      const coords = await editor.evaluate((element, bounds) => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        const a = view.coordsAtPos(bounds.from)!, b = view.coordsAtPos(bounds.to)!
        return { ax: a.left, ay: (a.top + a.bottom) / 2, bx: b.left, by: (b.top + b.bottom) / 2 }
      }, { from, to })
      await session.page.mouse.move(reverse ? coords.bx : coords.ax + 1, reverse ? coords.by : coords.ay)
      await session.page.mouse.down()
      await session.page.mouse.move(reverse ? coords.ax + 1 : coords.bx, reverse ? coords.ay : coords.by, { steps: 8 })
      await session.page.mouse.up()
      const range = await editor.evaluate(element => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        return { from: view.state.selection.main.from, to: view.state.selection.main.to }
      })
      expect(range).toEqual({ from, to })
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
      await session.page.keyboard.press('ControlOrMeta+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source.slice(from, to))
      const html = await session.app.evaluate(async ({ clipboard }) => {
        for (const item of await clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text()
        return ''
      })
      expect(await session.page.evaluate(value => new DOMParser().parseFromString(value, 'text/html').querySelector('pre')?.textContent, html)).toBe('**hello\n')
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
      await session.page.keyboard.press('ControlOrMeta+Shift+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source.slice(from, to))
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}
