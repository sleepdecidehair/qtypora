import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, setContextMenuChoice, stopDesktop } from './desktop-helpers'

test('右键粘贴 HTML 代码到代码正文应保留结构', async () => {
  const session = await launchDesktop()
  try {
    const source = '```js\nfirst\nlast\n```\n\nAfter'
    await openFixture(session, 'context-code-paste.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['value\n'], { type: 'text/plain' }), 'text/html': new Blob(['<pre><code>value\n</code></pre>'], { type: 'text/html' }) })])
    })
    await setContextMenuChoice(session, 'paste')
    await session.page.locator('.cm-live-code-body').last().click({ button: 'right', position: { x: 1, y: 8 } })
    const editor = session.page.locator('.cm-content')
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect.poll(content).toBe('```js\nfirst\nvalue\nlast\n```\n\nAfter')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(source)
    await session.app.evaluate(async ({ clipboard, ClipboardItem }) => {
      await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['```\n'], { type: 'text/plain' }), 'text/html': new Blob(['<pre><code>```\n</code></pre>'], { type: 'text/html' }) })])
    })
    await setContextMenuChoice(session, 'paste')
    await session.page.locator('.cm-live-code-body').last().click({ button: 'right', position: { x: 1, y: 8 } })
    await expect(session.page.getByText('无法安全粘贴到该代码位置，请调整选区或内容后重试。')).toBeVisible()
    await expect.poll(content).toBe(source)
  } finally { await stopDesktop(session) }
})

test('右键纯文本复制代码尾部换行', async () => {
  const session = await launchDesktop()
  try {
    const patched = await session.page.evaluate(() => window.desktop.patchPreferences({ floatingToolbar: false }))
    expect(patched.ok).toBe(true)
    const source = '```js\nhello\n```'
    await openFixture(session, 'context-code-copy.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate((element, range) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus()
    }, { from: source.indexOf('hello'), to: source.indexOf('hello') + 6 })
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('sentinel'))
    await setContextMenuChoice(session, 'copy-plain')
    await session.page.locator('.cm-live-code-body').first().click({ button: 'right', position: { x: 10, y: 8 } })
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('hello\n')
  } finally { await stopDesktop(session) }
})

test('右键复制代码选区保留纯文本换行和 HTML 代码内容', async () => {
  const session = await launchDesktop()
  try {
    const patched = await session.page.evaluate(() => window.desktop.patchPreferences({ floatingToolbar: false }))
    expect(patched.ok).toBe(true)
    const source = '```js\nhello\n```'
    await openFixture(session, 'context-code-copy-rich.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate((element, range) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus()
    }, { from: source.indexOf('hello'), to: source.indexOf('hello') + 6 })
    await setContextMenuChoice(session, 'copy')
    await session.page.locator('.cm-live-code-body').first().click({ button: 'right', position: { x: 10, y: 8 } })
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('hello\n')
    const html = await session.app.evaluate(async ({ clipboard }) => {
      for (const item of await clipboard.read()) if (item.types.includes('text/html')) return (await item.getType('text/html')).text()
      return ''
    })
    expect(await session.page.evaluate(value => new DOMParser().parseFromString(value, 'text/html').querySelector('pre')?.textContent, html)).toBe('hello\n')
    for (const action of ['copy-markdown', 'copy-html'] as const) {
      await editor.evaluate((element, range) => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        view.dispatch({ selection: { anchor: range.from, head: range.to } }); view.focus()
      }, { from: source.indexOf('hello'), to: source.indexOf('hello') + 6 })
      await setContextMenuChoice(session, action)
      await session.page.locator('.cm-live-code-body').first().click({ button: 'right', position: { x: 10, y: 8 } })
      if (action === 'copy-markdown') await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('hello\n')
      else {
        await expect.poll(async () => {
          const value = await session.app.evaluate(({ clipboard }) => clipboard.readText())
          return session.page.evaluate(source => new DOMParser().parseFromString(source, 'text/html').querySelector('pre')?.textContent, value)
        }).toBe('hello\n')
      }
    }
  } finally { await stopDesktop(session) }
})

test('右键纯文本粘贴按 BOM 和 CRLF 字节拒绝超限', async () => {
  test.setTimeout(120000)
  const session = await launchDesktop()
  try {
    await openFixture(session, 'context-byte-limit.md', Buffer.from('\ufeffBefore\r\n', 'utf8'))
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('汉'.repeat(5592402)))
    await setContextMenuChoice(session, 'paste-plain')
    await session.page.locator('.cm-line').first().click({ button: 'right', position: { x: 10, y: 8 } })
    await expect(session.page.getByText('粘贴后的文件将超过 16 MB，未执行粘贴。')).toBeVisible({ timeout: 60000 })
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('Before\n')
  } finally { await stopDesktop(session) }
})

for (const change of ['mode', 'selection'] as const) test(`右键异步粘贴期间${change === 'mode' ? '切换模式' : '改变选区'}不应用迟到内容`, async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'context-delay.md', 'Before')
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('qtypora:readClipboardText')
      ipcMain.handle('qtypora:readClipboardText', () => new Promise(resolve => { Reflect.set(globalThis, 'qtyporaTestContextPasteResolve', resolve) }))
    })
    await setContextMenuChoice(session, 'paste-plain')
    await session.page.locator('.cm-line').first().click({ button: 'right', position: { x: 10, y: 8 } })
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'qtyporaTestContextPasteResolve'))).toBe('function')
    if (change === 'mode') await session.page.keyboard.press('ControlOrMeta+/')
    else await session.page.keyboard.press('End')
    await session.app.evaluate(() => {
      const resolve = Reflect.get(globalThis, 'qtyporaTestContextPasteResolve') as (value: { ok: true; data: string }) => void
      resolve({ ok: true, data: 'STALE' }); Reflect.deleteProperty(globalThis, 'qtyporaTestContextPasteResolve')
    })
    await expect(session.page.getByText('文档或选区已变化，未粘贴文本。')).toBeVisible()
    const editor = session.page.locator('.cm-content')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('Before')
  } finally { await stopDesktop(session) }
})
