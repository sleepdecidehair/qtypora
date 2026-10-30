import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

for (const reverse of [false, true]) {
  test(`长文档${reverse ? '反向' : '正向'}跨代码块复制粘贴保留后续段落`, async () => {
    const session = await launchDesktop()
    try {
      const original = 'text\n\n'.repeat(1800) + '```js\nconst value = 1\n```\n\nAfter'
      const file = await openFixture(session, 'long-rich-copy.md', original)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      const from = original.indexOf('value'), to = original.length
      await session.app.evaluate(({ clipboard }) => clipboard.writeText('clipboard sentinel'))
      await editor.evaluate((element, selection) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection, scrollIntoView: true }); view.focus() }, reverse ? { anchor: to, head: from } : { anchor: from, head: to })
      await session.page.keyboard.press('ControlOrMeta+c')
      const clipboardHtml = () => session.app.evaluate(async ({ clipboard }) => {
        for (const item of await clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text()
        return ''
      })
      await expect.poll(clipboardHtml).toContain('After')
      const html = await clipboardHtml()
      const structure = await session.page.evaluate(value => { const doc = new DOMParser().parseFromString(value, 'text/html'); return { code: doc.querySelector('pre')?.textContent, paragraph: [...doc.querySelectorAll('p')].map(p => p.textContent) } }, html)
      expect(structure.code).toContain('value = 1')
      expect(structure.paragraph).toContain('After')
      await session.page.keyboard.press('ControlOrMeta+n')
      await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.length)).toBe(0)
      await editor.click()
      await session.page.keyboard.press('ControlOrMeta+v')
      await expect.poll(() => editor.locator('.cm-line').filter({ hasText: 'After' }).count()).toBe(1)
      await expect(editor.locator('.cm-line').filter({ hasText: 'After' })).not.toHaveClass(/cm-live-code-body/)
      expect(await readFile(file, 'utf8')).toBe(original)
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}
