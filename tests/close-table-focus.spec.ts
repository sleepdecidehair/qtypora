import { test, expect } from '@playwright/test'
import { clickNativeMenu, launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

for (const [direction, anchor, focus] of [['正向', 1, 2], ['反向', 2, 1]] as const) test(`表格 Alt 矩形选择后取消关闭，恢复${direction}文字选区`, async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n| four | five | six |\n'
    await openFixture(session, 'close-table-range.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const table = session.page.getByTestId('live-table')
    const previous = table.getByRole('cell', { name: '表格第 2 行第 1 列' })
    const start = table.getByRole('cell', { name: '表格第 2 行第 2 列' })
    const end = table.getByRole('cell', { name: '表格第 3 行第 3 列' })
    await previous.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('!')
    const startBounds = await start.boundingBox(), endBounds = await end.boundingBox()
    expect(startBounds && endBounds).toBeTruthy()
    await session.page.keyboard.down('Alt')
    await session.page.mouse.move(startBounds!.x + startBounds!.width / 2, startBounds!.y + startBounds!.height / 2)
    await session.page.mouse.down()
    await session.page.mouse.move(endBounds!.x + endBounds!.width / 2, endBounds!.y + endBounds!.height / 2, { steps: 6 })
    await session.page.mouse.up()
    await expect(table.locator('.cm-table-cell-selected')).toHaveCount(4)
    await expect(start).toBeFocused()
    const selectionInStart = await start.evaluate(element => {
      const content = element.closest('.cm-content')!
      const view = Reflect.get(content, 'cmTile').root.view as import('@codemirror/view').EditorView
      const from = Number((element as HTMLElement).dataset.sourceFrom), to = Number((element as HTMLElement).dataset.sourceTo)
      return view.state.selection.main.from >= from && view.state.selection.main.to <= to
    })
    expect(selectionInStart).toBe(false)
    await start.evaluate((element, selection) => {
      const text = element.firstChild
      if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('expected editable cell text')
      element.ownerDocument.getSelection()?.setBaseAndExtent(text, selection.anchor, text, selection.focus)
    }, { anchor, focus })
    expect(await session.page.evaluate(() => window.getSelection()?.toString())).toBe('w')
    expect(await session.page.evaluate(() => ({ anchor: window.getSelection()?.anchorOffset, focus: window.getSelection()?.focusOffset }))).toEqual({ anchor, focus })
    const selected = () => table.locator('.cm-table-cell-selected').evaluateAll(cells => cells.map(cell => `${(cell as HTMLElement).dataset.row}:${(cell as HTMLElement).dataset.column}`))
    const before = await selected()
    await session.app.evaluate(({ dialog }) => {
      Reflect.set(globalThis, 'tableRangeClosePrompt', 0)
      dialog.showMessageBox = async () => {
        Reflect.set(globalThis, 'tableRangeClosePrompt', Number(Reflect.get(globalThis, 'tableRangeClosePrompt')) + 1)
        return { response: 2, checkboxChecked: false }
      }
    })
    await clickNativeMenu(session, '关闭文档')
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'tableRangeClosePrompt'))).toBe(1)
    await expect(session.page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    await expect(start).toBeFocused()
    expect(await selected()).toEqual(before)
    expect(await session.page.evaluate(() => window.getSelection()?.toString())).toBe('w')
    expect(await session.page.evaluate(() => ({ anchor: window.getSelection()?.anchorOffset, focus: window.getSelection()?.focusOffset }))).toEqual({ anchor, focus })
    await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toBe(original.replace('one', 'one!'))
    await session.page.keyboard.up('Alt')
  } finally { await stopDesktop(session) }
})

test('取消关闭后恢复空表格单元格中的插入点', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| one |  |\n'
    await openFixture(session, 'close-empty-cell.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const table = session.page.getByTestId('live-table')
    const edited = table.getByRole('cell', { name: '表格第 2 行第 1 列' })
    const empty = table.getByRole('cell', { name: '表格第 2 行第 2 列' })
    await edited.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('!')
    await empty.click()
    await empty.evaluate(element => element.ownerDocument.getSelection()?.setBaseAndExtent(element, 0, element, 0))
    await session.app.evaluate(({ dialog }) => {
      Reflect.set(globalThis, 'emptyCellPrompt', 0)
      dialog.showMessageBox = async () => { Reflect.set(globalThis, 'emptyCellPrompt', 1); return { response: 2, checkboxChecked: false } }
    })
    await clickNativeMenu(session, '关闭文档')
    await expect.poll(() => session.app.evaluate(() => Reflect.get(globalThis, 'emptyCellPrompt'))).toBe(1)
    await expect(session.page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    await expect(empty).toBeFocused()
    expect(await empty.evaluate(element => {
      const selection = element.ownerDocument.getSelection()
      return selection?.anchorNode === element && selection.focusNode === element && selection.anchorOffset === 0 && selection.focusOffset === 0
    })).toBe(true)
    await session.page.keyboard.insertText('new')
    await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toBe(original.replace('one', 'one!').replace('| one! |  |', '| one! | new |'))
  } finally { await stopDesktop(session) }
})

test('关闭期间文档变化后不会把旧焦点放进另一张表', async () => {
  const session = await launchDesktop()
  try {
    const original = '| A | B |\n| --- | --- |\n| one | two |\n'
    const replacement = '| X | Y |\n| --- | --- |\n| other | table |\n'
    await openFixture(session, 'close-stale-cell.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const originalCell = session.page.getByTestId('live-table').getByRole('cell', { name: '表格第 2 行第 2 列' })
    await originalCell.click()
    await session.page.keyboard.press('End')
    await session.page.keyboard.insertText('!')
    await session.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => new Promise(resolve => { Reflect.set(globalThis, 'staleCellClose', resolve) })
    })
    await clickNativeMenu(session, '关闭文档')
    await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'staleCellClose'))).toBe('function')
    await session.page.locator('.cm-content').evaluate((element, next) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
    }, replacement)
    await session.app.evaluate(() => {
      const resolve = Reflect.get(globalThis, 'staleCellClose') as (result: { response: number; checkboxChecked: boolean }) => void
      resolve({ response: 2, checkboxChecked: false })
    })
    await expect(session.page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
    await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.toString()
    })).toBe(replacement)
    expect(await session.page.evaluate(() => document.activeElement?.closest('[data-testid="live-table"]') !== null)).toBe(false)
  } finally { await stopDesktop(session) }
})
