import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, setSaveDialog, stopDesktop } from './desktop-helpers'

test('HTML 普通标记跨 br 保留字面文字', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'literal-cross-break.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p>x==a<br>b==</p><p>x~~c<br>d~~</p><p><mark>real<br>mark</mark> <del>real<br>del</del></p>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('x\\=\\=a\\\nb\\=\\=\n\nx\\~\\~c\\\nd\\~\\~\n\n==real\\\nmark== ~~real\\\ndel~~')
    await expect(editor).toContainText('x==a')
    await expect(editor).toContainText('b==')
    await expect(editor).toContainText('x~~c')
    await expect(editor).toContainText('d~~')
    await expect(editor.locator('.cm-live-highlight')).toHaveCount(2)
    await expect(editor.locator('.cm-live-strike')).toHaveCount(2)
    const output = path.join(session.root, 'literal-cross-break.html')
    await setSaveDialog(session, output)
    await clickNativeMenu(session, 'HTML…')
    await expect.poll(async () => { try { return await readFile(output, 'utf8') } catch { return '' } }).toContain('x==a')
    const exported = await readFile(output, 'utf8')
    const structure = await session.page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const paragraphs = [...doc.querySelectorAll('body p')]
      return paragraphs.map(p => ({ text: p.textContent, mark: p.querySelectorAll('mark').length, strike: p.querySelectorAll('s').length }))
    }, exported)
    expect(structure[0]).toMatchObject({ text: 'x==a\nb==', mark: 0, strike: 0 })
    expect(structure[1]).toMatchObject({ text: 'x~~c\nd~~', mark: 0, strike: 0 })
    expect(structure[2]).toMatchObject({ mark: 1, strike: 1 })
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
