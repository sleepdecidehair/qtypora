import { test, expect } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('先复制后剪切时，迟到的复制不能覆盖剪切内容', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'copy-cut-order.md', 'first second')
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await session.app.evaluate(({ clipboard }) => {
      const shared = globalThis as typeof globalThis & { testCopyGate?: { entered: boolean; release: () => void; restore: () => void } }
      const original = clipboard.write.bind(clipboard)
      let release = () => {}
      const gate = new Promise<void>(resolve => { release = resolve })
      const state = { entered: false, finished: false, release, restore: () => { clipboard.write = original } }
      shared.testCopyGate = state
      clipboard.write = async items => { state.entered = true; await gate; await original(items); state.finished = true }
    })
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 0, head: 5 } }); view.focus()
    })
    await session.page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => session.app.evaluate(() => (globalThis as typeof globalThis & { testCopyGate?: { entered: boolean } }).testCopyGate?.entered)).toBe(true)
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 6, head: 12 } }); view.focus()
    })
    await session.page.keyboard.press('ControlOrMeta+x')
    expect(await editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('first second')
    await session.app.evaluate(() => (globalThis as typeof globalThis & { testCopyGate?: { release: () => void } }).testCopyGate?.release())
    await expect.poll(() => session.app.evaluate(() => (globalThis as typeof globalThis & { testCopyGate?: { finished: boolean } }).testCopyGate?.finished)).toBe(true)
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('second')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('first ')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('first second')
  } finally {
    await session.app.evaluate(() => (globalThis as typeof globalThis & { testCopyGate?: { release: () => void; restore: () => void } }).testCopyGate?.release()).catch(() => {})
    await session.app.evaluate(() => (globalThis as typeof globalThis & { testCopyGate?: { restore: () => void } }).testCopyGate?.restore()).catch(() => {})
    await stopDesktop(session)
  }
})

test('选区剪切写入失败时保留文档', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'cut-failure.md', 'first second')
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await session.app.evaluate(({ clipboard }) => {
      const shared = globalThis as typeof globalThis & { restoreCutWrite?: () => void }
      const original = clipboard.write.bind(clipboard)
      shared.restoreCutWrite = () => { clipboard.write = original }
      clipboard.write = async () => { throw new Error('injected clipboard failure') }
    })
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 6, head: 12 } }); view.focus()
    })
    await session.page.keyboard.press('ControlOrMeta+x')
    await expect(session.page.locator('.editor-context-error')).toBeVisible()
    expect(await editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('first second')
  } finally {
    await session.app.evaluate(() => (globalThis as typeof globalThis & { restoreCutWrite?: () => void }).restoreCutWrite?.()).catch(() => {})
    await stopDesktop(session)
  }
})

test('无选区原生整行剪切及行首粘贴保持不变', async () => {
  const session = await launchDesktop()
  try {
    await openFixture(session, 'linewise-cut.md', 'one\ntwo\nthree')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 5 } }); view.focus()
    })
    await session.page.keyboard.press('ControlOrMeta+x')
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('two')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('one\nthree')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ selection: { anchor: 0 } }); view.focus()
    })
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe('two\none\nthree')
  } finally { await stopDesktop(session) }
})
