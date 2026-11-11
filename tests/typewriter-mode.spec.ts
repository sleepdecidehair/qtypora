import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { captureDesktop, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

for (const mode of ['source', 'hybrid'] as const) test(`${mode} 视图下打字机模式默认点击居中，可切换为仅输入居中且撤销保留 Markdown 原文`, async () => {
  const session = await launchDesktop()
  try {
    session.page.on('console', message => { if (message.type() === 'error') session.errors.push(message.text()) })
    const original = Array.from({ length: 140 }, (_, index) => `第 ${index + 1} 行：用于滚动与选区测试的 Markdown 内容。`).join('\n') + '\n'
    const file = await openFixture(session, 'typewriter-input-only.md', original)
    const editor = session.page.locator('.cm-content')
    if (mode === 'hybrid') {
      await session.page.keyboard.press('ControlOrMeta+/')
      await expect(editor).toHaveAttribute('data-mode', 'hybrid')
    }
    const enabled = await session.page.evaluate(() => window.desktop.patchPreferences({ typewriterMode: true }))
    expect(enabled.ok).toBe(true)
    await expect(session.page.locator('.statusbar-left')).toContainText('打字机')

    const scroller = session.page.locator('.cm-scroller')
    const scrollTop = () => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.scrollDOM.scrollTop)
    const setScrollTop = (top: number) => editor.evaluate((element, value) => {
      (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.scrollDOM.scrollTop = value
    }, top)
    const centerOffset = () => editor.evaluate(element => {
      const view = (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view
      const caret = view.coordsAtPos(view.state.selection.main.head)
      return caret ? caret.top - (view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.clientHeight / 2) : Number.NaN
    })
    const clickAt = async (y: number) => {
      const box = await scroller.boundingBox()
      if (!box) throw new Error('Editor scroller is not visible')
      await session.page.mouse.click(box.x + 120, box.y + y)
    }
    const settleEditorFrames = () => session.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

    await expect.poll(() => scroller.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(200)
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(700)
    await settleEditorFrames()
    await setScrollTop(700)
    const centeredStart = await scrollTop()
    await clickAt(80)
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.selection.main.head)).toBeGreaterThan(0)
    await settleEditorFrames()
    await expect.poll(async () => Math.abs(await centerOffset())).toBeLessThan(35)
    expect(Math.abs(await scrollTop() - centeredStart)).toBeGreaterThan(20)

    await session.page.getByTestId('preferences-button').click()
    const alwaysCenter = session.page.getByTestId('typewriter-always-center-toggle')
    await expect(alwaysCenter).toBeChecked()
    await alwaysCenter.uncheck()
    await session.page.getByRole('button', { name: '关闭偏好设置' }).click()
    await expect(session.page.locator('.preferences-dialog')).toHaveCount(0)
    await expect.poll(async () => {
      const stored = await session.page.evaluate(() => window.desktop.bootstrap())
      return stored.ok ? stored.data.preferences.typewriterAlwaysCenter : null
    }).toBe(false)

    await setScrollTop(1100)
    const selectionBeforeClick = await editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.selection.main.head)
    const inputOnlyStart = await scrollTop()
    await clickAt(80)
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.selection.main.head)).not.toBe(selectionBeforeClick)
    await settleEditorFrames()
    expect(Math.abs(await scrollTop() - inputOnlyStart)).toBeLessThan(3)

    const selectionBeforeMove = await editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.selection.main.head)
    const beforeMoveScroll = await scrollTop()
    await session.page.keyboard.press('ArrowDown')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.selection.main.head)).not.toBe(selectionBeforeMove)
    await settleEditorFrames()
    expect(Math.abs(await scrollTop() - beforeMoveScroll)).toBeLessThan(3)

    const box = await scroller.boundingBox()
    if (!box) throw new Error('Editor scroller is not visible')
    const beforeDragScroll = await scrollTop()
    await session.page.mouse.move(box.x + 120, box.y + 100)
    await session.page.mouse.down()
    await session.page.mouse.move(box.x + 150, box.y + 160, { steps: 5 })
    await session.page.mouse.up()
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.selection.main.empty)).toBe(false)
    await settleEditorFrames()
    expect(Math.abs(await scrollTop() - beforeDragScroll)).toBeLessThan(3)

    const selectedSource = await editor.evaluate(element => {
      const view = (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view
      return { from: view.state.selection.main.from, to: view.state.selection.main.to }
    })
    await session.page.keyboard.insertText('x')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.doc.toString())).toBe(original.slice(0, selectedSource.from) + 'x' + original.slice(selectedSource.to))
    await expect.poll(async () => Math.abs(await centerOffset())).toBeLessThan(35)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.doc.toString())).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

for (const row of [1, 24]) test(`长表第 ${row} 行选择和导航不跳动，完整按键输入仍将单元格光标居中`, async () => {
  const session = await launchDesktop()
  try {
    session.page.on('console', message => { if (message.type() === 'error') session.errors.push(message.text()) })
    const before = Array.from({ length: 60 }, (_, index) => `表格前文 ${index + 1}：保留可观察的滚动空间。`).join('\n')
    const after = Array.from({ length: 60 }, (_, index) => `表格后文 ${index + 1}：保留可观察的滚动空间。`).join('\n')
    const rows = Array.from({ length: 24 }, (_, index) => `| one${index + 1} | two${index + 1} |`).join('\n')
    const original = `${before}\n\n## Table target\n\n| First | Second |\n| --- | --- |\n${rows}\n\n${after}\n`
    const file = await openFixture(session, 'typewriter-table-input.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await expect(editor).toHaveAttribute('data-mode', 'hybrid')
    const enabled = await session.page.evaluate(() => window.desktop.patchPreferences({ typewriterMode: true, typewriterAlwaysCenter: false }))
    expect(enabled.ok).toBe(true)
    await expect(session.page.locator('.statusbar-left')).toContainText('打字机')

    const scroller = session.page.locator('.cm-scroller')
    const table = session.page.getByTestId('live-table')
    const first = table.getByRole('cell', { name: `表格第 ${row + 1} 行第 1 列`, exact: true })
    const second = table.getByRole('cell', { name: `表格第 ${row + 1} 行第 2 列`, exact: true })
    const scrollTop = () => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.scrollDOM.scrollTop)
    const setScrollTop = (top: number) => editor.evaluate((element, value) => {
      (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.scrollDOM.scrollTop = value
    }, top)
    const settleEditorFrames = () => session.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const content = () => editor.evaluate(element => (Reflect.get(element, 'cmTile') as { root: { view: import('@codemirror/view').EditorView } }).root.view.state.doc.toString())

    await settleEditorFrames()
    await session.page.getByTestId('outline-item').filter({ hasText: 'Table target' }).click()
    await expect(first).toBeVisible()
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(900)
    await settleEditorFrames()
    const tableTop = await first.evaluate(element => {
      const scroller = element.closest('.cm-scroller')!
      return (scroller as HTMLElement).scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    })
    await setScrollTop(Math.max(0, tableTop - 130))
    const firstBox = await first.boundingBox()
    const scrollerBox = await scroller.boundingBox()
    if (!firstBox || !scrollerBox) throw new Error('Live table cell or editor scroller is not visible')
    expect(firstBox.y).toBeGreaterThan(scrollerBox.y)
    expect(firstBox.y + firstBox.height).toBeLessThan(scrollerBox.y + scrollerBox.height)

    const beforeClick = await scrollTop()
    await first.click()
    await settleEditorFrames()
    expect(Math.abs(await scrollTop() - beforeClick)).toBeLessThan(3)
    const beforeNavigation = await scrollTop()
    await session.page.keyboard.press('Tab')
    await expect(second).toBeFocused()
    await settleEditorFrames()
    expect(Math.abs(await scrollTop() - beforeNavigation)).toBeLessThan(3)
    await session.page.keyboard.press('Shift+Tab')
    await expect(first).toBeFocused()
    await settleEditorFrames()
    expect(Math.abs(await scrollTop() - beforeNavigation)).toBeLessThan(3)

    const beforeInput = await scrollTop()
    await session.page.keyboard.press('End')
    await session.page.keyboard.type('x')
    const edited = original.replace(`| one${row} | two${row} |`, `| one${row}x | two${row} |`)
    await expect.poll(content).toBe(edited)
    await expect.poll(() => first.evaluate(element => {
      const selection = window.getSelection()
      if (!selection?.focusNode || !element.contains(selection.focusNode)) return Number.NaN
      const range = document.createRange()
      range.setStart(selection.focusNode, selection.focusOffset)
      range.collapse(true)
      return range.getBoundingClientRect().top
    })).toBeGreaterThan(scrollerBox.y + 100)
    await expect.poll(() => first.evaluate(element => {
      const selection = window.getSelection()
      if (!selection?.focusNode || !element.contains(selection.focusNode)) return Number.NaN
      const range = document.createRange()
      range.setStart(selection.focusNode, selection.focusOffset)
      range.collapse(true)
      const scroller = element.closest('.cm-scroller')!
      return range.getBoundingClientRect().top - (scroller.getBoundingClientRect().top + (scroller as HTMLElement).clientHeight / 2)
    }).then(Math.abs)).toBeLessThan(35)
    expect(Math.abs(await scrollTop() - beforeInput)).toBeGreaterThan(100)
    await settleEditorFrames()
    if (row === 24) await captureDesktop(session, path.join(process.cwd(), '.debug', 'typora-parity-2026-11-11', 'typewriter-table.png'), { presentInactive: true })
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(edited)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(content).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
