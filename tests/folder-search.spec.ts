import { test, expect } from '@playwright/test'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captureDesktop, launchDesktop, setOpenDialog, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

async function searchFolder(folder: string, query: string): Promise<void> {
  await setOpenDialog(session, [folder])
  await session.page.getByTestId('export-menu').click()
  await session.page.getByTestId('open-folder').click()
  await expect(session.page.getByTestId('workspace-folder')).toContainText(path.basename(folder))
  await session.page.getByTestId('search-tab').click()
  await session.page.getByTestId('folder-search-input').fill(query)
}

async function openDocument(file: string, content: string): Promise<void> {
  await writeFile(file, content)
  await setOpenDialog(session, [file])
  await session.page.keyboard.press('ControlOrMeta+o')
  await expect(session.page.getByTestId('document-name')).toHaveText(path.basename(file))
}

const renderedMatches = (active = false) => session.page.evaluate(selected => {
  const highlight = CSS.highlights.get(selected ? 'qtypora-folder-search-active' : 'qtypora-folder-search')
  return highlight ? [...highlight].map(range => (range as Range).toString()) : []
}, active)

const source = () => session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString())

test('搜索可排除目录名与相对路径，设置持久化且不修改文件', async () => {
  const folder = path.join(session.root, 'filtered-search')
  const included = path.join(folder, 'notes.md')
  const excluded = path.join(folder, 'private', 'secret.md')
  const nested = path.join(folder, 'projects', 'one', 'generated', 'build.md')
  for (const file of [included, excluded, nested]) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, '# needle\n') }
  await openDocument(excluded, '# needle\n')
  await searchFolder(folder, 'needle')
  const results = session.page.locator('.search-result')
  await expect(results).toHaveCount(3)
  await expect.poll(() => renderedMatches()).toEqual(['needle'])
  const filter = session.page.getByLabel('搜索排除目录')
  await filter.fill('private, projects/*/generated')
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('notes.md')
  await expect.poll(() => renderedMatches()).toEqual([])
  await expect.poll(async () => {
    const result = await session.page.evaluate(() => window.desktop.bootstrap())
    return result.ok ? result.data.preferences.workspace.searchExclude : null
  }).toBe('private, projects/*/generated')
  await filter.fill('../outside')
  await expect(session.page.getByRole('alert')).toContainText('工作区相对路径')
  await filter.fill('')
  await expect(results).toHaveCount(3)
  for (const file of [included, excluded, nested]) expect(await readFile(file, 'utf8')).toBe('# needle\n')
})

test('目录搜索高亮摘要、标题和表格，跳转后保持高亮且清空搜索会移除', async () => {
  const folder = path.join(session.root, 'notes')
  await mkdir(folder)
  const original = '# 文档\n\n## 002｜沃尔玛\n\n普通 002，第二次 002。\n\n行内公式 $x^2$\n\n| 编号 | 状态 |\n| --- | --- |\n| 002 | 完成 |\n'
  const file = path.join(folder, 'hits.md')
  await openDocument(file, original)
  await session.page.keyboard.press('ControlOrMeta+/')
  await searchFolder(folder, '002')
  const results = session.page.locator('.search-result')
  await expect(results).toHaveCount(3)
  await expect(results.locator('mark')).toHaveCount(4)
  await expect.poll(() => renderedMatches()).toEqual(['002', '002', '002', '002'])
  await results.first().click()
  await expect(results.first()).toHaveAttribute('aria-current', 'location')
  await expect.poll(() => renderedMatches(true)).toEqual(['002'])
  await expect(session.page.locator('.cm-line[data-source-line="3"]')).toHaveText('002｜沃尔玛')
  await results.last().click()
  await expect.poll(() => renderedMatches(true)).toEqual(['002'])
  expect(await source()).toBe(original)
  await session.page.getByTestId('folder-search-input').fill('编辑')
  await expect(results).toHaveCount(0)
  await expect.poll(() => renderedMatches()).toEqual([])
  await session.page.getByTestId('folder-search-input').fill('')
  await expect(results).toHaveCount(0)
  await expect.poll(() => renderedMatches()).toEqual([])
  expect(await readFile(file, 'utf8')).toBe(original)
})

test('只读文档、源码视图、大小写和深色主题均支持高亮，离开搜索后清理', async () => {
  const folder = path.join(session.root, 'readonly-notes')
  await mkdir(folder)
  const file = path.join(folder, 'readonly.md')
  const original = '# Word word WORD\n\n只有中文。\n'
  await writeFile(file, original)
  await chmod(file, 0o444)
  try {
    await searchFolder(folder, 'word')
    const result = session.page.locator('.search-result')
    await expect(result).toHaveCount(1)
    await result.click()
    await expect(session.page.locator('.document-heading')).toContainText('只读')
    await expect.poll(() => renderedMatches()).toEqual(['Word', 'word', 'WORD'])
    await session.page.getByLabel('区分大小写', { exact: true }).check()
    await expect(result.locator('mark')).toHaveText('word')
    await expect.poll(() => renderedMatches()).toEqual(['word'])
    await session.page.keyboard.press('ControlOrMeta+/')
    await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
    await expect.poll(() => renderedMatches()).toEqual(['word'])
    await session.page.getByTestId('preferences-button').click()
    await session.page.getByTestId('theme-select').selectOption('dark')
    await session.page.getByRole('button', { name: '完成', exact: true }).click()
    await expect(session.page.getByRole('dialog', { name: '偏好设置' })).toHaveCount(0)
    await expect(session.page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => renderedMatches()).toEqual(['word'])
    await expect(result.locator('mark')).toHaveCSS('background-color', 'rgb(99, 85, 41)')
    await session.page.getByTestId('folder-search-input').fill('不存在')
    await expect(result).toHaveCount(0)
    await expect.poll(() => renderedMatches()).toEqual([])
    await session.page.getByTestId('folder-search-input').fill('word')
    await expect.poll(() => renderedMatches()).toEqual(['word'])
    await session.page.getByTestId('files-tab').click()
    await expect.poll(() => renderedMatches()).toEqual([])
    expect(await source()).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
  } finally { await chmod(file, 0o666) }
})

test('滚动、切换文件和编辑后更新高亮，匹配摘要不会被前文截断', async () => {
  const folder = path.join(session.root, 'long-notes')
  await mkdir(folder)
  const original = `${'正文没有匹配\n\n'.repeat(150)}## 002｜末尾标题\n\n${'长前文'.repeat(100)}002\n`
  await openDocument(path.join(folder, 'long.md'), original)
  await writeFile(path.join(folder, 'second.md'), '# 第二篇\n\n002 002\n')
  await session.page.keyboard.press('ControlOrMeta+/')
  await searchFolder(folder, '002')
  const results = session.page.locator('.search-result')
  await expect(results).toHaveCount(3)
  const longResult = results.filter({ hasText: '长前文' })
  await expect(longResult.locator('mark')).toHaveText('002')
  const visible = await longResult.locator('mark').evaluate(element => {
    const rect = element.getBoundingClientRect(); const outer = element.closest('small')!.getBoundingClientRect()
    return rect.left >= outer.left && rect.right <= outer.right
  })
  expect(visible).toBe(true)
  await results.filter({ hasText: '末尾标题' }).click()
  await expect.poll(() => renderedMatches(true)).toEqual(['002'])
  const heading = session.page.locator('.cm-line[data-source-line="301"]')
  await expect(heading).toHaveText('002｜末尾标题')
  const box = await heading.boundingBox(); const scroller = await session.page.locator('.cm-scroller').boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(scroller!.y)
  expect(box!.y + box!.height).toBeLessThanOrEqual(scroller!.y + scroller!.height)
  await results.filter({ hasText: 'second.md' }).click()
  await expect(session.page.getByTestId('document-name')).toHaveText('second.md')
  await expect.poll(() => source()).toBe('# 第二篇\n\n002 002\n')
  await expect.poll(() => renderedMatches(true)).toEqual(['002', '002'])
  await expect(session.page.locator('.cm-content')).toBeFocused()
  await session.page.keyboard.press('End')
  await session.page.keyboard.insertText(' 002')
  await expect.poll(() => renderedMatches()).toEqual(['002', '002', '002'])
  await results.filter({ hasText: '末尾标题' }).click()
  await expect.poll(() => renderedMatches(true)).toEqual(['002'])
  expect(await source()).toBe(original)
  await captureDesktop(session, '.debug/folder-search-highlight.png')
})
