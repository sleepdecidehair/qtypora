import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, redoKey, stopDesktop } from './desktop-helpers'

test('Alt+上下只移动表格数据行，保留整行并支持一步撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '# 表格\n\n| A | B | C |\n| --- | --- | --- |\n| one | ONE | 11 |\n| two | TWO | 22 |\n| three | THREE | 33 |\n\noutside paragraph\n'
    const file = await openFixture(session, 'typora-table-rows.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const table = session.page.getByTestId('live-table')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    const activeCell = () => session.page.evaluate(() => {
      const cell = document.activeElement?.closest<HTMLElement>('[data-testid="live-table"] th, [data-testid="live-table"] td')
      return cell ? { row: Number(cell.dataset.row), column: Number(cell.dataset.column), content: cell.textContent } : null
    })
    const movedUp = original.replace('| one | ONE | 11 |\n| two | TWO | 22 |', '| two | TWO | 22 |\n| one | ONE | 11 |')
    await expect(table).toBeVisible()
    await table.getByRole('cell', { name: '表格第 3 行第 2 列' }).click()
    await session.page.keyboard.press('Alt+ArrowUp')
    await expect.poll(source).toBe(movedUp)
    await expect.poll(activeCell).toEqual({ row: 1, column: 1, content: 'TWO' })
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    await session.page.keyboard.press(redoKey)
    await expect.poll(source).toBe(movedUp)
    await expect.poll(activeCell).toEqual({ row: 1, column: 1, content: 'TWO' })

    await table.getByRole('cell', { name: '表格第 2 行第 2 列' }).click()
    await session.page.keyboard.press('Alt+ArrowDown')
    await expect.poll(source).toBe(original)
    await expect.poll(activeCell).toEqual({ row: 2, column: 1, content: 'TWO' })

    const firstBodyCell = table.getByRole('cell', { name: '表格第 2 行第 2 列' })
    await firstBodyCell.click()
    for (const shortcut of ['Alt+Shift+ArrowDown', 'Alt+Control+ArrowDown', 'Alt+Meta+ArrowDown']) {
      await session.page.keyboard.press(shortcut)
      await expect.poll(source).toBe(original)
    }
    await firstBodyCell.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await session.page.keyboard.press('Alt+ArrowDown')
    await firstBodyCell.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await expect.poll(source).toBe(original)

    await table.locator('thead th').first().click()
    await session.page.keyboard.press('Alt+ArrowDown')
    await expect.poll(source).toBe(original)
    await table.locator('tbody tr').last().locator('td').nth(1).click()
    await session.page.keyboard.press('Alt+ArrowDown')
    await expect.poll(source).toBe(original)
    await table.getByRole('cell', { name: '表格第 2 行第 2 列' }).click()
    await session.page.keyboard.press('Alt+ArrowUp')
    await expect.poll(source).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
