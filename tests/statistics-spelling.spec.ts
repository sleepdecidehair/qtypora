import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { contextMenuActions, launchDesktop, openFixture, setContextMenuChoice, stopDesktop } from './desktop-helpers'

test('统计单位从状态栏保存，已有窗口同步且重启后恢复', async () => {
  let session = await launchDesktop()
  try {
    await openFixture(session, 'statistics-unit.md', '**two words**')
    const opening = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    const second = await opening
    second.on('pageerror', error => session.errors.push(error.message))
    await expect(second.getByTestId('word-count')).toBeVisible()
    const secondCharacters = await second.locator('.cm-content').evaluate(element => [...Reflect.get(element, 'cmTile').root.view.state.doc.toString()].length)
    await session.page.getByTestId('word-count').click()
    await session.page.getByLabel('统计单位', { exact: true }).selectOption('characters')
    await expect(session.page.getByTestId('word-count')).toHaveText('13 字符')
    await expect(second.getByTestId('word-count')).toHaveText(`${secondCharacters} 字符`)
    await second.getByTestId('word-count').click()
    await second.getByLabel('统计单位', { exact: true }).selectOption('words')
    await expect(session.page.getByTestId('word-count')).toHaveText('2 字')
    await session.page.getByLabel('统计单位', { exact: true }).selectOption('characters')
    await expect.poll(async () => JSON.parse(await readFile(path.join(session.userData, 'settings.json'), 'utf8')).preferences.statisticsUnit).toBe('characters')
    expect(session.errors).toEqual([])
    const root = session.root
    await stopDesktop(session, false)
    session = await launchDesktop(root)
    const restoredCharacters = await session.page.locator('.cm-content').evaluate(element => [...Reflect.get(element, 'cmTile').root.view.state.doc.toString()].length)
    await expect(session.page.getByTestId('word-count')).toHaveText(`${restoredCharacters} 字符`)
    await session.page.getByTestId('word-count').click()
    await expect(session.page.getByLabel('统计单位', { exact: true })).toHaveValue('characters')
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('临时拼写忽略只存在于当前窗口，可恢复和清空且刷新重置', async () => {
  const session = await launchDesktop()
  try {
    const before = await session.page.evaluate(() => window.desktop.listSpellingWords())
    expect((await session.page.evaluate(() => window.desktop.ignoreSpelling('Helo')))).toEqual({ ok: true, data: ['Helo'] })
    const spelling = await session.page.evaluate(() => window.desktop.readSpelling('HELO'))
    expect(spelling).toMatchObject({ ok: true, data: { ignored: true, suggestions: [] } })
    const opening = session.app.waitForEvent('window')
    await session.page.evaluate(() => window.desktop.newWindow())
    const second = await opening
    await second.locator('.cm-content').waitFor()
    expect(await second.evaluate(() => window.desktop.listIgnoredSpellingWords())).toEqual({ ok: true, data: [] })
    await session.page.getByTestId('preferences-button').click()
    await session.page.getByText('当前窗口忽略的拼写建议（1）', { exact: true }).click()
    await expect(session.page.getByText('只在当前窗口忽略，大小写不区分；刷新或关闭窗口后清空，不写入系统词典。原生红色波浪线可能仍保留。', { exact: true })).toBeVisible()
    await session.page.getByRole('button', { name: '恢复拼写建议 Helo', exact: true }).click()
    await expect(session.page.getByText('当前窗口忽略的拼写建议（0）', { exact: true })).toBeVisible()
    expect(await session.page.evaluate(() => window.desktop.listIgnoredSpellingWords())).toEqual({ ok: true, data: [] })
    await session.page.getByRole('button', { name: '完成', exact: true }).click()
    await session.page.evaluate(async () => { await window.desktop.ignoreSpelling('Helo'); await window.desktop.ignoreSpelling('Wurld') })
    await session.page.getByTestId('preferences-button').click()
    await session.page.getByText('当前窗口忽略的拼写建议（2）', { exact: true }).click()
    await session.page.getByRole('button', { name: '清空当前窗口的忽略记录', exact: true }).click()
    expect(await session.page.evaluate(() => window.desktop.listIgnoredSpellingWords())).toEqual({ ok: true, data: [] })
    await session.page.evaluate(() => window.desktop.ignoreSpelling('Helo'))
    await session.page.reload()
    await session.page.locator('.cm-content').waitFor()
    expect(await session.page.evaluate(() => window.desktop.listIgnoredSpellingWords())).toEqual({ ok: true, data: [] })
    expect(await session.page.evaluate(() => window.desktop.listSpellingWords())).toEqual(before)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('拼写右键临时忽略保留原文和系统词典，再次右键不显示该词建议', async () => {
  const session = await launchDesktop()
  try {
    const word = 'mispellng'
    const file = await openFixture(session, 'spelling-ignore.md', word)
    expect((await session.page.evaluate(() => window.desktop.patchPreferences({ spellcheck: true }))).ok).toBe(true)
    await expect(session.page.locator('.cm-content')).toHaveAttribute('spellcheck', 'true')
    const spelling = await session.page.evaluate(word => window.desktop.readSpelling(word), word)
    test.skip(!spelling.ok || !spelling.data.misspelled, '本机原生词典尚未提供拼写错误结果；窗口忽略与管理另有不依赖词典的用例')
    const dictionary = await session.page.evaluate(() => window.desktop.listSpellingWords())
    const point = await session.page.locator('.cm-content').evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view
      const position = view.coordsAtPos(3)
      if (!position) throw new Error('Missing word coordinates')
      return { x: position.left, y: (position.top + position.bottom) / 2 }
    })
    await setContextMenuChoice(session, 'spell-ignore')
    await session.page.mouse.click(point.x, point.y, { button: 'right' })
    await expect.poll(() => session.page.evaluate(() => window.desktop.listIgnoredSpellingWords())).toEqual({ ok: true, data: [word] })
    await setContextMenuChoice(session, null)
    await session.page.mouse.click(point.x, point.y, { button: 'right' })
    await expect.poll(() => contextMenuActions(session)).toContain('bold')
    expect((await contextMenuActions(session)).some(action => action.startsWith('spell-'))).toBe(false)
    expect(await session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString())).toBe(word)
    expect(await readFile(file, 'utf8')).toBe(word)
    expect(await session.page.evaluate(() => window.desktop.listSpellingWords())).toEqual(dictionary)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
