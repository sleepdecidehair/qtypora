import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  if (!session) return
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

const source = () => session.page.locator('.cm-content').evaluate(element => {
  const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
  return view.state.doc.toString()
})

test('正文默认适应宽窄窗口，仍可选择并保存固定宽度', async () => {
  await openFixture(session, 'layout.md', '# 宽屏正文\n\n这段正文随窗口加宽。\n')
  await session.page.keyboard.press('Control+/')
  const geometry = () => session.page.locator('.cm-content').evaluate(element => {
    const scroll = element.closest('.cm-scroller')!
    const style = getComputedStyle(element)
    return { content: element.clientWidth, available: scroll.clientWidth, padding: Number.parseFloat(style.paddingLeft), overflow: scroll.scrollWidth - scroll.clientWidth }
  })
  for (const width of [1600, 760]) {
    await session.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 860), width)
    await expect.poll(async () => (await geometry()).content / (await geometry()).available).toBeGreaterThan(0.98)
    expect((await geometry()).padding).toBe(32)
    expect((await geometry()).overflow).toBeLessThanOrEqual(1)
  }
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 860))
  await session.page.getByTestId('preferences-button').click()
  await expect(session.page.getByLabel('正文最大宽度')).toBeDisabled()
  await session.page.getByLabel('正文布局').selectOption('fixed')
  await session.page.getByLabel('正文最大宽度').fill('960')
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await expect.poll(async () => (await geometry()).content).toBe(960)
  await expect.poll(async () => JSON.parse(await readFile(path.join(session.userData, 'settings.json'), 'utf8')).preferences.contentWidthMode).toBe('fixed')
  await session.page.getByTestId('preferences-button').click()
  await session.page.getByLabel('正文布局').selectOption('auto')
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await expect.poll(async () => (await geometry()).content / (await geometry()).available).toBeGreaterThan(0.98)
})

test('工具栏切换留白并恢复自定义宽度，两种编辑视图和重启均保持选择', async () => {
  const original = '# 布局切换\n\n正文 **格式** 和光标保持原样。\n'
  await openFixture(session, 'width-toggle.md', original)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 860))
  const button = session.page.getByRole('button', { name: '正文留白', exact: true })
  const geometry = () => session.page.locator('.cm-content').evaluate(element => {
    const scroller = element.closest('.cm-scroller')!
    const rect = element.getBoundingClientRect()
    const outer = scroller.getBoundingClientRect()
    return { width: element.clientWidth, available: scroller.clientWidth, overflow: scroller.scrollWidth - scroller.clientWidth, left: rect.left - outer.left, right: outer.right - rect.right }
  })
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await geometry()).width).toBe(800)
  await session.page.getByTestId('preferences-button').click()
  await expect(session.page.getByLabel('正文布局')).toHaveValue('fixed')
  await session.page.getByLabel('正文最大宽度').fill('960')
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await expect.poll(async () => (await geometry()).width).toBe(960)
  await session.page.keyboard.press('Control+/')
  await expect.poll(async () => (await geometry()).width).toBe(960)
  const constrained = await geometry()
  expect(constrained.left).toBeGreaterThan(100)
  expect(Math.abs(constrained.left - constrained.right)).toBeLessThan(2)
  const selection = () => session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.selection.toJSON())
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.press('Control+End')
  const beforeSelection = await selection()
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await geometry()).width / (await geometry()).available).toBeGreaterThan(0.98)
  expect(await source()).toBe(original)
  expect(await selection()).toEqual(beforeSelection)
  await button.click()
  await expect.poll(async () => (await geometry()).width).toBe(960)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 860))
  await expect.poll(async () => (await geometry()).overflow).toBeLessThanOrEqual(1)
  const settingsFile = path.join(session.userData, 'settings.json')
  await expect.poll(async () => JSON.parse(await readFile(settingsFile, 'utf8')).preferences).toMatchObject({ contentWidthMode: 'fixed', contentWidth: 960 })
  const root = session.root
  await stopDesktop(session, false)
  session = await launchDesktop(root)
  await expect(session.page.getByTestId('content-width-toggle')).toHaveAttribute('aria-pressed', 'true')
  await session.page.keyboard.press('Control+/')
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
  await expect.poll(async () => {
    const current = await geometry()
    return current.width === Math.min(960, current.available)
  }).toBe(true)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 860))
  await expect.poll(async () => (await geometry()).width).toBe(960)
  await session.page.screenshot({ path: '.debug/content-width-fixed.png' })
})

test('标题没有下划线，双击标题、正文、列表和引用展开本行并可编辑、收起', async () => {
  const original = '# 一级标题\n\n## 二级标题\n\n普通 **粗体** 与 [链接](https://example.com)\n\n- 列表 **粗体**\n\n> 引用 **粗体**\n\n- [x] 完成事项\n\n结束\n'
  const file = await openFixture(session, 'line-editing.md', original)
  await session.page.keyboard.press('Control+/')
  const editor = session.page.locator('.cm-content')
  for (const level of [1, 2]) {
    const heading = editor.locator(`.cm-live-heading-${level}`)
    expect(await heading.evaluate(element => getComputedStyle(element).borderBottomWidth)).toBe('0px')
    expect(await heading.evaluate(element => [element, ...element.querySelectorAll('span')].some(node => getComputedStyle(node).textDecorationLine.includes('underline')))).toBe(false)
  }
  for (const lineNumber of [3, 5, 7, 9, 11]) {
    const line = editor.locator(`.cm-line[data-source-line="${lineNumber}"]`)
    await line.dblclick()
    await expect(line).toHaveClass(/cm-live-edit-line/)
    await expect(line).toHaveText(original.split('\n')[lineNumber - 1])
    expect(await source()).toBe(original)
    await session.page.keyboard.press('Escape')
    await expect(editor.locator('.cm-live-edit-line')).toHaveCount(0)
  }
  await editor.locator('.cm-live-heading-2').dblclick()
  await session.page.keyboard.press('End')
  await session.page.keyboard.insertText('已编辑')
  await session.page.keyboard.press('Escape')
  await expect(editor.locator('.cm-live-heading-2')).toHaveText('二级标题已编辑')
  await editor.locator('.cm-live-heading-1').dblclick()
  await editor.locator('.cm-line').filter({ hasText: /^结束$/ }).click()
  await expect(editor.locator('.cm-live-edit-line')).toHaveCount(0)
  await session.page.keyboard.press('Control+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(original.replace('二级标题', '二级标题已编辑'))
})

test('图片等比放大且完整可见，双击图片、公式、图表、表格及代码展开源码', async () => {
  await writeFile(path.join(session.root, 'small.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#53789a"/></svg>')
  await writeFile(path.join(session.root, 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="2400"><rect width="600" height="2400" fill="#53789a"/></svg>')
  const original = '# 资源\n\n![小图片](small.svg)\n\n![竖图](portrait.svg)\n\n$$x^2$$\n\n```mermaid\ngraph LR\nA[开始] --> B[结束]\n```\n\n| Name | State |\n| --- | --- |\n| 原值 | 完成 |\n\n```js\nconst answer = 42\n```\n\n结束\n'
  const file = await openFixture(session, 'resources.md', original)
  await session.page.keyboard.press('Control+/')
  const editor = session.page.locator('.cm-content')
  for (const alt of ['小图片', '竖图']) {
    const image = editor.getByRole('img', { name: alt, exact: true })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const geometry = await image.evaluate(element => {
      const image = element as HTMLImageElement
      const content = image.closest('.cm-content')!
      const scroll = image.closest('.cm-scroller')!
      const style = getComputedStyle(content)
      const rect = image.getBoundingClientRect()
      return { width: rect.width, height: rect.height, naturalWidth: image.naturalWidth, ratio: rect.width / rect.height, naturalRatio: image.naturalWidth / image.naturalHeight,
        availableWidth: content.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight), availableHeight: scroll.clientHeight - 80 }
    })
    expect(geometry.width).toBeLessThanOrEqual(geometry.availableWidth + 1)
    expect(geometry.height).toBeLessThanOrEqual(geometry.availableHeight + 1)
    expect(geometry.ratio).toBeCloseTo(geometry.naturalRatio, 2)
    if (alt === '小图片') expect(geometry.width).toBeGreaterThan(geometry.naturalWidth * 2)
    await image.scrollIntoViewIfNeeded()
    await image.dblclick()
    await expect(editor.locator('.cm-live-edit-block')).toContainText(alt === '小图片' ? 'small.svg' : 'portrait.svg')
    await session.page.keyboard.press('Escape')
    await expect(image).toBeVisible()
  }
  for (const selector of ['.md-math math', '.md-mermaid svg', '[data-testid="live-table"] tbody td:first-child', '.cm-live-code-body']) {
    const target = editor.locator(selector).first()
    await expect(target).toBeVisible()
    await target.dblclick()
    await expect(editor.locator('.cm-live-edit-line').first()).toBeVisible()
    expect(await source()).toBe(original)
    await session.page.keyboard.press('Escape')
    await expect(editor.locator('.cm-live-edit-line')).toHaveCount(0)
    await expect(editor.locator(selector).first()).toBeVisible()
  }
  const cell = editor.locator('[data-testid="live-table"] tbody td').first()
  await cell.click()
  await session.page.keyboard.press('Control+e')
  await session.page.keyboard.insertText('新值')
  await session.page.keyboard.press('Control+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(original.replace('原值', '新值'))
})
