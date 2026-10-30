import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('HTML 格式边界空格显示与原始 HTML 一致', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'space-coordinate.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob(['<p>a <strong> b </strong> c</p>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('a **b** c')
    const gaps = await editor.evaluate(element => {
      const line = element.querySelector('.cm-line')!
      const original = document.createElement('span')
      original.style.font = getComputedStyle(line).font
      original.style.whiteSpace = 'normal'
      original.innerHTML = 'a <strong> b </strong> c'
      document.body.append(original)
      const edge = (node: Node, offset: number) => {
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset)
        return range.getBoundingClientRect().left
      }
      const originalA = original.firstChild!, originalB = original.querySelector('strong')!.firstChild!
      const tree = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      while (tree.nextNode()) nodes.push(tree.currentNode as Text)
      const a = nodes.find(node => node.data.includes('a'))!, b = nodes.find(node => node.data === 'b')!
      const result = { original: edge(originalB, 1) - edge(originalA, 1), editor: edge(b, 0) - edge(a, a.data.indexOf('a') + 1) }
      original.remove(); return result
    })
    expect(Math.abs(gaps.editor - gaps.original)).toBeLessThan(1)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('相邻格式的普通空白折叠，NBSP 和代码空格保持', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'space-boundaries.md', '')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const html = '<p><strong>a </strong><strong> b</strong> x&nbsp;<em>&nbsp;y&nbsp;</em>&nbsp;z <code>a  b</code></p><pre>A  B\n\n\nC</pre>'
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['fallback'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('**a b** x\u00a0\u00a0*y*\u00a0\u00a0z `a  b`\n\n```\nA  B\n\n\nC\n```')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe('')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
