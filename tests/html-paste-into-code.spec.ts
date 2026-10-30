import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('代码正文内粘贴 HTML 保留代码块结构', async () => {
  const session = await launchDesktop()
  try {
    const source = '```js\nfirst\nlast\n```\n\nAfter'
    const file = await openFixture(session, 'paste-into-code.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate((element, position) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: position }, scrollIntoView: true }); view.focus()
    }, source.indexOf('last'))
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['value\n'], { type: 'text/plain' }), 'text/html': new Blob(['<pre><code>value\n</code></pre>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('```js\nfirst\nvalue\nlast\n```\n\nAfter')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe('```js\nfirst\nvalue\nlast\n```\n\nAfter')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(source)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('可能关闭原围栏的 HTML 粘贴不会更改文档', async () => {
  const session = await launchDesktop()
  try {
    const source = '```js\nfirst\nlast\n```\n\nAfter'
    await openFixture(session, 'paste-fence-conflict.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate((element, position) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: position } }); view.focus()
    }, source.indexOf('last'))
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['```\n'], { type: 'text/plain' }), 'text/html': new Blob(['<pre><code>```\n</code></pre>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect(session.page.getByText('无法安全粘贴到该代码位置，请调整选区或内容后重试。')).toBeVisible()
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(source)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

for (const [name, source, prefix] of [
  ['引用', '> ```js\n> first\n> last\n> ```', '> '],
  ['列表', '- ```js\n  first\n  last\n  ```', '  '],
  ['嵌套', '> - ```js\n>   first\n>   last\n>   ```', '>   '],
] as const) {
  test(`${name}内代码粘贴保留前缀、结构及撤销`, async () => {
    const session = await launchDesktop()
    try {
      const file = await openFixture(session, 'nested-paste.md', source)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      const focusCode = async () => editor.evaluate((element, position) => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        view.dispatch({ selection: { anchor: position } }); view.focus()
      }, source.indexOf('last'))
      await focusCode()
      await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
        await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['value\n'], { type: 'text/plain' }), 'text/html': new Blob(['<pre><code>value\n</code></pre>'], { type: 'text/html' }) })])
      })
      await session.page.keyboard.press('ControlOrMeta+v')
      const expected = source.replace('last', `value\n${prefix}last`)
      await session.page.keyboard.press('ControlOrMeta+s')
      await expect.poll(() => readFile(file, 'utf8')).toBe(expected)
      expect(await session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('value\n')
      await session.page.keyboard.press('ControlOrMeta+z')
      const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
      await expect.poll(content).toBe(source)
      await focusCode()
      await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
        await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['```\n'], { type: 'text/plain' }), 'text/html': new Blob(['<pre><code>```\n</code></pre>'], { type: 'text/html' }) })])
      })
      await session.page.keyboard.press('ControlOrMeta+v')
      await expect(session.page.getByText('无法安全粘贴到该代码位置，请调整选区或内容后重试。')).toBeVisible()
      await expect.poll(content).toBe(source)
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}

test('引用内空代码正文粘贴首尾换行可保存并撤销', async () => {
  const session = await launchDesktop()
  try {
    const source = '> ```\n> \n> ```'
    const file = await openFixture(session, 'empty-nested-paste.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate((element, position) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: position } }); view.focus()
    }, source.indexOf('> \n') + 2)
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['\na\n'], { type: 'text/plain' }), 'text/html': new Blob(['<pre><code>\na\n</code></pre>'], { type: 'text/html' }) })])
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe('> ```\n> \n> a\n> \n> ```')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(source)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
