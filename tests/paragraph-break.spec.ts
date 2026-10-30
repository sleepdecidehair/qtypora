import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('实时预览 Enter 新段落与 Shift Enter 单换行可撤销并保存源码', async () => {
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'break.md', 'onetwo')
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await editor.click()
    await session.page.keyboard.press('Home')
    for (let i = 0; i < 3; i++) await session.page.keyboard.press('ArrowRight')
    await session.page.keyboard.press('Enter')
    await expect.poll(source).toBe('one\n\ntwo')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe('onetwo')
    await session.page.keyboard.press('Shift+Enter')
    await expect.poll(source).toBe('one\ntwo')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe('one\ntwo')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('实时预览软换行处 Enter 不添加多余空行，实体内部保持完整', async () => {
  const session = await launchDesktop()
  try {
    const file = await openFixture(session, 'break-boundaries.md', 'one\ntwo')
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 3 } }); view.focus() })
    await session.page.keyboard.press('Enter')
    await expect.poll(source).toBe('one\n\ntwo')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe('one\ntwo')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe('one\ntwo')
    await openFixture(session, 'entity-break.md', 'A&amp;B')
    await editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 3 } }); view.focus() })
    await session.page.keyboard.press('Enter')
    expect(await source()).toBe('A&amp;B')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('实时预览行内公式及高亮标记内 Enter 不拆坏源码', async () => {
  const session = await launchDesktop()
  try {
    const original = '公式 $x+y$ 和 ==高亮==。'
    const file = await openFixture(session, 'inline-break.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    for (const anchor of [original.indexOf('x') + 1, original.indexOf('高') + 1]) {
      await editor.evaluate((element, position) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: position } }); view.focus() }, anchor)
      await session.page.keyboard.press('Enter')
      expect(await source()).toBe(original)
    }
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('实时预览反向选中普通文字后 Enter 分段并撤销选区', async () => {
  const session = await launchDesktop()
  try {
    const original = 'onetwo'
    const file = await openFixture(session, 'selection-break.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const state = () => editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; return { source: view.state.doc.toString(), anchor: view.state.selection.main.anchor, head: view.state.selection.main.head } })
    await editor.evaluate(element => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: 4, head: 2 } }); view.focus() })
    await session.page.keyboard.press('Enter')
    await expect.poll(async () => (await state()).source).toBe('on\n\nwo')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(state).toEqual({ source: original, anchor: 4, head: 2 })
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('实时预览跨行公式内 Enter 不破坏公式或源码', async () => {
  const session = await launchDesktop()
  try {
    const original = '前 $x.\ny$ 后'
    const file = await openFixture(session, 'multiline-math-break.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await editor.evaluate((element, position) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor: position } }); view.focus() }, original.indexOf('y'))
    await session.page.keyboard.press('Enter')
    expect(await editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('引用和列表续行先保护实体，普通续行仍可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '> A&amp;B\n\n- A&amp;B'
    const file = await openFixture(session, 'container-break.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    const caret = (position: number) => editor.evaluate((element, anchor) => { const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView; view.dispatch({ selection: { anchor } }); view.focus() }, position)
    for (const position of [original.indexOf('&') + 2, original.lastIndexOf('&') + 2]) {
      await caret(position)
      await session.page.keyboard.press('Enter')
      expect(await source()).toBe(original)
    }
    await caret(original.indexOf('\n'))
    await session.page.keyboard.press('Enter')
    await expect.poll(source).toBe('> A&amp;B\n> \n\n- A&amp;B')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
