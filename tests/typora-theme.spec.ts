import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clickNativeMenu, launchDesktop, openFixture, setSaveDialog, stopDesktop } from './desktop-helpers'

const color = (page: Page) => page.locator('.cm-content').evaluate(element => getComputedStyle(element).color)

test('Typora 主题选择、刷新和重启保持安全样式与 Markdown 原文', async () => {
  let session = await launchDesktop()
  try {
    const themes = path.join(session.userData, 'themes')
    await mkdir(themes, { recursive: true })
    await writeFile(path.join(themes, 'paper.css'), 'body { color: rgb(12, 34, 56); }')
    await writeFile(path.join(themes, 'unsafe.css'), '@import url("https://example.invalid/theme.css");')
    const original = '# 主题测试\n\n原文 **保持** 不变。\n'
    const source = await openFixture(session, 'theme.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const opening = session.app.waitForEvent('window')
    await session.page.evaluate(file => window.desktop.newWindow(file), source)
    const second = await opening
    await second.locator('.cm-content').waitFor()
    await session.page.getByTestId('preferences-button').click()
    const select = session.page.getByLabel('Typora 主题', { exact: true })
    await expect(select.locator('option[value="paper"]')).toHaveCount(1)
    await select.selectOption('paper')
    await expect(select).toHaveValue('paper')
    await expect.poll(() => color(session.page)).toBe('rgb(12, 34, 56)')
    await expect.poll(() => color(second)).toBe('rgb(12, 34, 56)')
    await expect.poll(async () => JSON.parse(await readFile(path.join(session.userData, 'settings.json'), 'utf8')).preferences.typoraThemeId).toBe('paper')
    await select.selectOption('unsafe')
    await expect(session.page.getByRole('alert')).toContainText('不支持')
    await expect(select).toHaveValue('paper')
    expect(await color(session.page)).toBe('rgb(12, 34, 56)')
    await writeFile(path.join(themes, 'paper.css'), 'body { color: rgb(78, 90, 123); }')
    await session.page.getByRole('button', { name: '刷新主题' }).click()
    await expect.poll(() => color(session.page)).toBe('rgb(78, 90, 123)')
    await session.page.getByRole('button', { name: '完成', exact: true }).click()
    expect(await readFile(source, 'utf8')).toBe(original)
    const root = session.root
    await stopDesktop(session, false)
    session = await launchDesktop(root)
    await expect.poll(() => color(session.page)).toBe('rgb(78, 90, 123)')
    await session.page.getByTestId('preferences-button').click()
    await expect(session.page.getByLabel('Typora 主题', { exact: true })).toHaveValue('paper')
    expect(await readFile(source, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

for (const damage of ['missing', 'corrupt'] as const) {
  test(`主题${damage === 'missing' ? '缺失' : '损坏'}时 Markdown 导出保持可用，HTML 导出安全失败`, async () => {
    const session = await launchDesktop()
    try {
      const themes = path.join(session.userData, 'themes')
      await mkdir(themes, { recursive: true })
      const stylesheet = path.join(themes, 'paper.css')
      await writeFile(stylesheet, 'body { color: rgb(12, 34, 56); }')
      const original = '# 原文\n\n内容保持不变。\n'
      const source = await openFixture(session, 'theme-export.md', original)
      await session.page.getByTestId('preferences-button').click()
      const select = session.page.getByLabel('Typora 主题', { exact: true })
      await expect(select.locator('option[value="paper"]')).toHaveCount(1)
      await select.selectOption('paper')
      await expect(select).toHaveValue('paper')
      await expect.poll(() => color(session.page)).toBe('rgb(12, 34, 56)')
      await session.page.getByRole('button', { name: '完成', exact: true }).click()
      if (damage === 'missing') await unlink(stylesheet)
      else await writeFile(stylesheet, '@import url("https://example.invalid/unsafe.css");')
      const markdownOutput = path.join(session.root, `${damage}.md`)
      await setSaveDialog(session, markdownOutput)
      await clickNativeMenu(session, '更多导出格式与设置…')
      await session.page.getByLabel('导出格式', { exact: true }).selectOption('markdown')
      await session.page.getByRole('button', { name: '导出…', exact: true }).click()
      await expect.poll(async () => { try { return await readFile(markdownOutput, 'utf8') } catch { return '' } }).toBe(original)
      const htmlOutput = path.join(session.root, `${damage}.html`)
      await writeFile(htmlOutput, 'preserved output')
      await setSaveDialog(session, htmlOutput)
      await session.page.getByLabel('导出格式', { exact: true }).selectOption('html')
      await session.page.getByRole('button', { name: '导出…', exact: true }).click()
      await expect(session.page.getByTestId('error-notification')).toContainText('主题')
      expect(await readFile(htmlOutput, 'utf8')).toBe('preserved output')
      expect(await readFile(source, 'utf8')).toBe(original)
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}

test('主题变量、媒体规则和自定义样式在 Chromium 中按预期级联', async () => {
  const session = await launchDesktop()
  try {
    const themes = path.join(session.userData, 'themes')
    await mkdir(themes, { recursive: true })
    await writeFile(path.join(themes, 'cssom.css'), ':root { --heading: rgb(12, 34, 56); } h1 { color: var(--heading, red); background-color: var(--missing, #fedcba); } @media (min-width: 320px) { h1 { font-weight: 800; } }')
    const original = '# 主题标题\n\n正文\n'
    const source = await openFixture(session, 'theme-cssom.md', original)
    await session.page.getByTestId('editor-mode').click()
    await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
    await expect(session.page.locator('.cm-content')).toContainText('主题标题')
    await session.page.locator('.cm-content').focus()
    await session.page.keyboard.press('ControlOrMeta+End')
    const heading = session.page.locator('.cm-live-heading-1').first()
    await expect(heading).toHaveCount(1)
    await session.page.getByTestId('preferences-button').click()
    const select = session.page.getByLabel('Typora 主题', { exact: true })
    await expect(select.locator('option[value="cssom"]')).toHaveCount(1)
    await select.selectOption('cssom')
    await expect.poll(() => heading.evaluate(element => getComputedStyle(element).color)).toBe('rgb(12, 34, 56)')
    await expect.poll(() => heading.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(254, 220, 186)')
    await expect.poll(() => heading.evaluate(element => getComputedStyle(element).fontWeight)).toBe('800')
    await session.page.getByLabel('正文自定义 CSS').fill('.cm-live-heading-1 { color: rgb(101, 102, 103); }')
    await expect.poll(() => heading.evaluate(element => getComputedStyle(element).color)).toBe('rgb(101, 102, 103)')
    expect(await readFile(source, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
