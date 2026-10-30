import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

for (const closed of [true, false]) for (const reverse of [false, true]) {
  test(`${closed ? '闭合' : '未闭合'}代码块${reverse ? '反向' : '正向'}复制保留原始标点`, async () => {
    const session = await launchDesktop()
    try {
      const original = 'text\n\n'.repeat(1800) + '```js\n**hello**\n' + (closed ? '```\n\nAfter' : '')
      const file = await openFixture(session, 'code-literal.md', original)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      const from = original.indexOf('**hello**'), to = from + 9
      await editor.evaluate((element, selection) => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        view.dispatch({ selection, scrollIntoView: true }); view.focus()
      }, reverse ? { anchor: to, head: from } : { anchor: from, head: to })
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
      await session.page.keyboard.press('ControlOrMeta+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('**hello**')
      const html = await session.app.evaluate(async ({ clipboard }) => {
        for (const item of await clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text()
        return ''
      })
      expect(await session.page.evaluate(value => new DOMParser().parseFromString(value, 'text/html').querySelector('pre')?.textContent, html)).toContain('**hello**')
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
      await session.page.keyboard.press('ControlOrMeta+Shift+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('**hello**')
      expect(await readFile(file, 'utf8')).toBe(original)
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}

for (const ending of ['\n', '\n\n']) {
  test(`代码选区复制保留 ${ending.length} 个结尾换行`, async () => {
    const session = await launchDesktop()
    try {
      const original = '```js\nhello' + ending + '```\n\nAfter'
      const file = await openFixture(session, 'code-newlines.md', original)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      await editor.evaluate((element, length) => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        view.dispatch({ selection: { anchor: 6, head: 6 + length } }); view.focus()
      }, 5 + ending.length)
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
      await session.page.keyboard.press('ControlOrMeta+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('hello' + ending)
      const { html, rtf } = await session.app.evaluate(async ({ clipboard }) => {
        let html = '', rtf = ''
        for (const item of await clipboard.read()) {
          if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text()
          if (item.types.includes('text/rtf')) rtf = await (await item.getType('text/rtf')).text()
        }
        return { html, rtf }
      })
      expect(await session.page.evaluate(value => new DOMParser().parseFromString(value, 'text/html').querySelector('pre')?.textContent, html)).toBe('hello' + ending)
      expect((rtf.match(/\\line /g) || []).length).toBe(ending.length)
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
      await session.page.keyboard.press('ControlOrMeta+Shift+c')
      await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('hello' + ending)
      expect(await readFile(file, 'utf8')).toBe(original)
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}
