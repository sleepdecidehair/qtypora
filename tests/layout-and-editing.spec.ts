import { test, expect } from '@playwright/test'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captureDesktop, clickNativeMenu, contextMenuActions, launchDesktop, openFixture, setContextMenuChoice, setOpenDialog, stopDesktop, type DesktopSession } from './desktop-helpers'

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

test('大纲部分折叠后仍可全部折叠及展开', async () => {
  const text = '# 甲\n\n## 甲子\n\n# 乙\n\n## 乙子\n'
  const file = await openFixture(session, 'outline-collapse-all.md', text)
  await session.page.getByTestId('outline-tab').click()
  const outline = session.page.locator('.outline-panel')
  await expect(outline.getByTestId('outline-item')).toHaveCount(4)
  await outline.getByRole('button', { name: '折叠 甲', exact: true }).click()
  await expect(outline.getByTestId('outline-item')).toHaveCount(3)
  await outline.getByRole('button', { name: '全部折叠', exact: true }).click()
  await expect(outline.getByTestId('outline-item')).toHaveCount(2)
  const filter = outline.getByLabel('筛选标题')
  await filter.fill('子')
  await expect(outline.getByTestId('outline-item')).toHaveCount(2)
  await filter.clear()
  await expect(outline.getByTestId('outline-item')).toHaveCount(2)
  await outline.getByRole('button', { name: '全部展开', exact: true }).click()
  await expect(outline.getByTestId('outline-item')).toHaveCount(4)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('大纲右键平铺显示子项并保留层级、筛选、跳转和原文', async () => {
  const text = '# 甲\n\n## 甲子\n\n# 乙\n\n## 乙子\n'
  const file = await openFixture(session, 'outline-flat.md', text)
  await session.page.getByTestId('outline-tab').click()
  const outline = session.page.locator('.outline-panel')
  await outline.getByRole('button', { name: '折叠 甲', exact: true }).click()
  await expect(outline.getByTestId('outline-item')).toHaveCount(3)
  await setContextMenuChoice(session, 'outline-flat')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(outline.getByTestId('outline-item')).toHaveCount(4)
  await expect(outline.locator('.outline-collapse')).toHaveCount(0)
  const offsets = await outline.locator('.outline-row').evaluateAll(rows => rows.map(row => getComputedStyle(row).paddingLeft))
  expect(offsets[1]).not.toBe(offsets[0])
  const filter = outline.getByLabel('筛选标题')
  await filter.fill('甲子')
  await expect(outline.getByTestId('outline-item')).toHaveCount(1)
  await outline.getByTestId('outline-item').click()
  await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return view.state.doc.lineAt(view.state.selection.main.head).number
  })).toBe(3)
  await filter.clear()
  await setContextMenuChoice(session, 'outline-collapsible')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(outline.getByTestId('outline-item')).toHaveCount(3)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('大纲右键切换筛选框时清空筛选并正确恢复焦点', async () => {
  const text = '# 第一章\n\n## 细节\n\n# 第二章\n'
  const file = await openFixture(session, 'outline-filter-menu.md', text)
  await session.page.getByTestId('outline-tab').click()
  const outline = session.page.locator('.outline-panel')
  const filter = outline.getByLabel('筛选标题')
  await expect(filter).toBeVisible()
  await filter.fill('细节')
  await expect(outline.getByTestId('outline-item')).toHaveCount(1)
  await expect(outline.getByTestId('outline-item').locator('mark')).toHaveText('细节')
  await setContextMenuChoice(session, 'outline-filter')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(filter).toHaveCount(0)
  await expect(outline).toBeFocused()
  await expect(outline.getByTestId('outline-item')).toHaveCount(3)
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(filter).toHaveValue('')
  await expect(filter).toBeFocused()
  await filter.fill('第一')
  await filter.press('Escape')
  await expect(filter).toHaveCount(0)
  await expect(outline).toBeFocused()
  await expect(outline.getByTestId('outline-item')).toHaveCount(3)
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(filter).toBeFocused()
  await expect(filter).toHaveValue('')
  await filter.fill('细节')
  await outline.getByRole('button', { name: '关闭大纲筛选' }).click()
  await expect(filter).toHaveCount(0)
  await expect(outline).toBeFocused()
  await expect(outline.getByTestId('outline-item')).toHaveCount(3)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('大纲筛选支持方向键选择及回车跳转', async () => {
  const text = '# 章节甲\n\n## 章节乙\n\n# 章节丙\n'
  const file = await openFixture(session, 'outline-keyboard.md', text)
  await session.page.getByTestId('outline-tab').click()
  const outline = session.page.locator('.outline-panel')
  const input = outline.getByLabel('筛选标题')
  await input.fill('章节')
  await input.press('ArrowDown')
  await expect(outline.locator('[data-outline-keyboard="true"]')).toContainText('章节甲')
  await input.press('ArrowDown')
  await expect(outline.locator('[data-outline-keyboard="true"]')).toContainText('章节乙')
  await expect(outline.locator('.outline-selection-status')).toHaveText('章节乙')
  await input.press('Enter')
  await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return view.state.doc.lineAt(view.state.selection.main.head).number
  })).toBe(3)
  await expect(input).toBeFocused()
  await input.fill('没有匹配')
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(outline.locator('[data-outline-keyboard="true"]')).toHaveCount(0)
  await input.fill('章节')
  await input.press('ArrowDown')
  await expect(outline.locator('[data-outline-keyboard="true"]')).toHaveCount(1)
  await openFixture(session, 'outline-keyboard-second.md', '# 新文档\n')
  await expect(outline.locator('[data-outline-keyboard="true"]')).toHaveCount(0)
  await expect(input).toHaveValue('')
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('大纲右键全部展开和折叠作用于完整层级，平铺时隐藏操作', async () => {
  const text = '# 甲\n\n## 甲子\n\n# 乙\n\n## 乙子\n'
  const file = await openFixture(session, 'outline-fold-menu.md', text)
  await session.page.getByTestId('outline-tab').click()
  const outline = session.page.locator('.outline-panel')
  const filter = outline.getByLabel('筛选标题')
  await filter.fill('甲')
  await setContextMenuChoice(session, 'outline-collapse-all')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(outline.getByTestId('outline-item')).toHaveCount(2)
  await filter.clear()
  await expect(outline.getByTestId('outline-item')).toHaveCount(2)
  await setContextMenuChoice(session, 'outline-expand-all')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(outline.getByTestId('outline-item')).toHaveCount(4)
  await setContextMenuChoice(session, 'outline-flat')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(outline.locator('.outline-collapse')).toHaveCount(0)
  await setContextMenuChoice(session, null)
  await outline.locator('.sidebar-label').click({ button: 'right' })
  const actions = await contextMenuActions(session)
  expect(actions).not.toContain('outline-expand-all')
  expect(actions).not.toContain('outline-collapse-all')
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('大纲定位当前章节仅展开祖先并保留其他分支', async () => {
  const text = '# 甲\n\n## 甲子\n\n### 甲孙\n\n# 乙\n\n## 乙子\n'
  const file = await openFixture(session, 'outline-locate-menu.md', text)
  await session.page.getByTestId('outline-tab').click()
  const outline = session.page.locator('.outline-panel')
  await session.page.locator('.cm-line').filter({ hasText: '甲孙' }).click()
  await expect(outline.getByTestId('outline-item').filter({ hasText: '甲孙' })).toHaveAttribute('aria-current', 'location')
  await outline.getByRole('button', { name: '折叠 甲子', exact: true }).click()
  await outline.getByRole('button', { name: '折叠 甲', exact: true }).click()
  await outline.getByRole('button', { name: '折叠 乙', exact: true }).click()
  await outline.getByLabel('筛选标题').fill('乙')
  await setContextMenuChoice(session, 'outline-locate')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(outline.getByLabel('筛选标题')).toHaveValue('')
  await expect(outline.getByTestId('outline-item').filter({ hasText: '甲孙' })).toHaveAttribute('aria-current', 'location')
  await expect(outline.getByRole('button', { name: '展开 乙', exact: true })).toBeVisible()
  await expect(outline.getByTestId('outline-item').filter({ hasText: '乙子' })).toHaveCount(0)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('点击折叠的大纲标题时跳转并展开当前项', async () => {
  const text = '# 甲\n\n## 甲子\n\n# 乙\n\n## 乙子\n'
  const file = await openFixture(session, 'outline-click-expand.md', text)
  await session.page.getByTestId('outline-tab').click()
  const outline = session.page.locator('.outline-panel')
  await outline.getByRole('button', { name: '折叠 甲', exact: true }).click()
  await outline.getByRole('button', { name: '折叠 乙', exact: true }).click()
  await outline.getByTestId('outline-item').filter({ hasText: '甲' }).click()
  await expect(outline.getByTestId('outline-item').filter({ hasText: '甲子' })).toBeVisible()
  await expect(outline.getByTestId('outline-item').filter({ hasText: '乙子' })).toHaveCount(0)
  await expect.poll(() => session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return view.state.doc.lineAt(view.state.selection.main.head).number
  })).toBe(1)
  await outline.getByRole('button', { name: '折叠 甲', exact: true }).click()
  await setContextMenuChoice(session, 'outline-flat')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(outline.getByTestId('outline-item')).toHaveCount(4)
  await outline.getByTestId('outline-item').filter({ hasText: '甲' }).first().click()
  await setContextMenuChoice(session, 'outline-collapsible')
  await outline.locator('.sidebar-label').click({ button: 'right' })
  await expect(outline.getByTestId('outline-item').filter({ hasText: '甲子' })).toHaveCount(0)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('大纲平铺设置跨侧栏切换、窗口及重启保留', async () => {
  const text = '# 一级\n\n## 二级\n'
  const file = await openFixture(session, 'outline-flat-persistence.md', text)
  const opening = session.app.waitForEvent('window')
  await session.page.evaluate(() => window.desktop.newWindow())
  const second = await opening
  await second.getByTestId('outline-tab').click()
  await session.page.getByTestId('outline-tab').click()
  await setContextMenuChoice(session, 'outline-flat')
  await session.page.locator('.outline-panel .sidebar-label').click({ button: 'right' })
  await expect(session.page.locator('.outline-options button').first()).toBeDisabled()
  await expect(second.locator('.outline-options button').first()).toBeDisabled()
  await session.page.getByTestId('files-tab').click()
  await session.page.getByTestId('outline-tab').click()
  await expect(session.page.locator('.outline-options button').first()).toBeDisabled()
  const settings = path.join(session.userData, 'settings.json')
  await expect.poll(async () => JSON.parse(await readFile(settings, 'utf8')).preferences.outlineFlat).toBe(true)
  const root = session.root
  await stopDesktop(session, false)
  session = await launchDesktop(root)
  await setOpenDialog(session, [file])
  await session.page.keyboard.press('ControlOrMeta+o')
  await session.page.getByTestId('outline-tab').click()
  await expect(session.page.locator('.outline-options button').first()).toBeDisabled()
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('段落首行缩进只改变首个视觉行，源码模式和自定义 CSS 保持正确', async () => {
  const text = `${'word '.repeat(100)}\ncontinued\n\n# heading\n\n- list\n\n\`\`\`\ncode\n\`\`\``
  const file = await openFixture(session, 'paragraph-indent.md', text)
  const editor = session.page.locator('.cm-content')
  const lines = editor.locator('.cm-line')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await clickNativeMenu(session, '段落首行缩进')
  await expect(lines.first()).toHaveClass(/cm-paragraph-first-line-indent/)
  await expect(lines.nth(1)).not.toHaveClass(/cm-paragraph-first-line-indent/)
  const geometry = await lines.first().evaluate(element => {
    const node = element.firstChild!
    const first = document.createRange(); first.setStart(node, 0); first.setEnd(node, 1)
    const last = document.createRange(); last.setStart(node, node.textContent!.length - 1); last.setEnd(node, node.textContent!.length)
    const box = element.getBoundingClientRect(), a = first.getBoundingClientRect(), b = last.getBoundingClientRect()
    let wrapped = -1
    for (let i = 1; i < node.textContent!.length; i++) {
      const character = document.createRange(); character.setStart(node, i); character.setEnd(node, i + 1)
      const rect = character.getBoundingClientRect()
      if (rect.top > a.top) { wrapped = rect.left - box.left; break }
    }
    return { first: a.left - box.left, wrapped, firstTop: a.top, lastTop: b.top, font: parseFloat(getComputedStyle(element).fontSize) }
  })
  expect(geometry.first).toBeCloseTo(geometry.font * 2, 0)
  expect(geometry.lastTop).toBeGreaterThan(geometry.firstTop)
  expect(geometry.wrapped).toBeCloseTo(0, 0)
  expect(await lines.nth(1).evaluate(element => getComputedStyle(element).textIndent)).toBe('0px')
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'source')
  await expect(lines.first()).not.toHaveClass(/cm-paragraph-first-line-indent/)
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(lines.first()).toHaveClass(/cm-paragraph-first-line-indent/)
  await session.page.getByTestId('preferences-button').click()
  await session.page.getByLabel('正文自定义 CSS').fill('.cm-line { text-indent: 3em; }')
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await expect.poll(() => lines.first().evaluate(element => parseFloat(getComputedStyle(element).textIndent) / parseFloat(getComputedStyle(element).fontSize))).toBe(3)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('引用段落首行缩进保留折行、源码及自定义 CSS', async () => {
  const text = `> ${'word '.repeat(100)}\n> continued\n\n- list\n  > nested quote`
  const file = await openFixture(session, 'quote-paragraph-indent.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await clickNativeMenu(session, '段落首行缩进')
  const lines = editor.locator('.cm-line')
  await expect(lines.first()).toHaveClass(/cm-paragraph-first-line-indent/)
  await expect(lines.nth(1)).not.toHaveClass(/cm-paragraph-first-line-indent/)
  await expect(lines.last()).not.toHaveClass(/cm-paragraph-first-line-indent/)
  const geometry = await lines.first().evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode()) && !node.textContent?.startsWith('word')) {}
    if (!node?.textContent) throw new Error('Missing visible quote text')
    const first = document.createRange(); first.setStart(node, 0); first.setEnd(node, 1)
    const a = first.getBoundingClientRect(), box = element.getBoundingClientRect(), style = getComputedStyle(element)
    const base = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
    let wrapped = -1
    for (let i = 1; i < node.textContent.length; i++) {
      const character = document.createRange(); character.setStart(node, i); character.setEnd(node, i + 1)
      const rect = character.getBoundingClientRect()
      if (rect.top > a.top) { wrapped = rect.left - base; break }
    }
    return { first: a.left - base, wrapped, font: parseFloat(style.fontSize) }
  })
  expect(geometry.first).toBeCloseTo(geometry.font * 2, 0)
  expect(geometry.wrapped).toBeCloseTo(0, 0)
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'source')
  await expect(lines.first()).not.toHaveClass(/cm-paragraph-first-line-indent/)
  await session.page.keyboard.press('ControlOrMeta+/')
  await session.page.getByTestId('preferences-button').click()
  await session.page.getByLabel('正文自定义 CSS').fill('.cm-line { text-indent: 3em; }')
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await expect.poll(() => lines.first().evaluate(element => parseFloat(getComputedStyle(element).textIndent) / parseFloat(getComputedStyle(element).fontSize))).toBe(3)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('状态栏显示切换保留原文并在窗口之间同步', async () => {
  const text = '# 标题\n\n正文内容'
  const file = await openFixture(session, 'status-bar.md', text)
  const opening = session.app.waitForEvent('window')
  await session.page.evaluate(() => window.desktop.newWindow())
  const second = await opening
  await expect(second.locator('.statusbar')).toBeVisible()
  const footer = session.page.locator('.statusbar')
  await expect(footer).toBeVisible()
  const before = await session.page.locator('.writing-space').evaluate(element => element.getBoundingClientRect().height)
  await clickNativeMenu(session, '显示 / 隐藏状态栏')
  await expect(footer).toBeHidden()
  await expect(second.locator('.statusbar')).toBeHidden()
  await expect.poll(() => session.page.locator('.writing-space').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(before)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
  await clickNativeMenu(session, '显示 / 隐藏状态栏')
  await expect(footer).toBeVisible()
  await expect(second.locator('.statusbar')).toBeVisible()
})

test('编辑菜单查找上一个与下一个使用当前查询并保留原文', async () => {
  const text = 'alpha beta alpha gamma'
  const file = await openFixture(session, 'find-menu.md', text)
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+Home')
  await session.page.keyboard.press('ControlOrMeta+f')
  const input = session.page.locator('.cm-search input[name="search"]')
  await expect(input).toBeVisible()
  await input.pressSequentially('alpha')
  const selection = () => editor.evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return { from: view.state.selection.main.from, to: view.state.selection.main.to }
  })
  await clickNativeMenu(session, '查找下一个')
  await expect.poll(selection).toEqual({ from: 0, to: 5 })
  await clickNativeMenu(session, '查找下一个')
  await expect.poll(selection).toEqual({ from: 11, to: 16 })
  await clickNativeMenu(session, '查找上一个')
  await expect.poll(selection).toEqual({ from: 0, to: 5 })
  await session.app.evaluate(({ clipboard }) => clipboard.writeText('beta'))
  await input.focus()
  await session.page.keyboard.press('ControlOrMeta+a')
  await session.page.keyboard.press('ControlOrMeta+v')
  await clickNativeMenu(session, '查找下一个')
  await expect.poll(selection).toEqual({ from: 6, to: 10 })
  await input.focus()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '粘贴为纯文本')
  await expect(input).toHaveValue('beta')
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('编辑菜单替换下一个使用粘贴查询且一次撤销恢复原文', async () => {
  const text = 'alpha beta alpha'
  const file = await openFixture(session, 'replace-next-menu.md', text)
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+Home')
  await clickNativeMenu(session, '替换')
  const query = session.page.locator('.cm-search input[name="search"]')
  const replacement = session.page.locator('.cm-search input[name="replace"]')
  await expect(query).toBeVisible()
  await replacement.pressSequentially('new')
  await session.app.evaluate(({ clipboard }) => clipboard.writeText('alpha'))
  await query.focus()
  await session.page.keyboard.press('ControlOrMeta+v')
  await clickNativeMenu(session, '替换下一个')
  await expect.poll(source).toBe(text)
  await clickNativeMenu(session, '替换下一个')
  await expect.poll(source).toBe('new beta alpha')
  await editor.focus()
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('编辑菜单替换下一个不修改只读文档', async () => {
  const text = 'alpha beta alpha'
  const file = path.join(session.root, 'replace-readonly.md')
  await writeFile(file, text)
  await chmod(file, 0o444)
  try {
    await setOpenDialog(session, [file])
    await session.page.keyboard.press('ControlOrMeta+o')
    await expect(session.page.locator('.document-heading')).toContainText('只读')
    await clickNativeMenu(session, '替换下一个')
    await clickNativeMenu(session, '替换下一个')
    await session.app.evaluate(({ clipboard }) => clipboard.writeText('不应插入'))
    await session.page.locator('.cm-content').click()
    await clickNativeMenu(session, '粘贴为纯文本')
    expect(await source()).toBe(text)
    expect(await readFile(file, 'utf8')).toBe(text)
  } finally {
    await chmod(file, 0o666)
  }
})

test('macOS 标题区域融入页面且工具栏与底部操作可用', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 窗口布局')
  await openFixture(session, 'seamless.md', '# 可编辑\n')
  const titlebar = session.page.getByTestId('mac-titlebar')
  await expect(titlebar).toHaveText('seamless.md')
  const geometry = await session.page.evaluate(() => {
    const title = document.querySelector('.mac-titlebar')!.getBoundingClientRect()
    const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect()
    const footer = document.querySelector('.statusbar')!
    return { titleBottom: title.bottom, toolbarTop: toolbar.top, footerBorder: getComputedStyle(footer).borderTopWidth }
  })
  expect(geometry.titleBottom).toBe(geometry.toolbarTop)
  expect(geometry.footerBorder).toBe('0px')
  const initialMode = await session.page.getByTestId('source-toggle').getAttribute('aria-pressed')
  await session.page.getByTestId('editor-mode').click()
  await expect(session.page.getByTestId('source-toggle')).toHaveAttribute('aria-pressed', initialMode === 'true' ? 'false' : 'true')
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.press('End')
  await session.page.keyboard.type(' edit')
  await session.page.keyboard.press('ControlOrMeta+z')
  expect(await source()).toBe('# 可编辑\n')
})

test('正文默认适应宽窄窗口，仍可选择并保存固定宽度', async () => {
  await openFixture(session, 'layout.md', '# 宽屏正文\n\n这段正文随窗口加宽。\n')
  await session.page.keyboard.press('ControlOrMeta+/')
  const geometry = () => session.page.locator('.cm-content').evaluate(element => {
    const scroll = element.closest('.cm-scroller')!
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const outer = scroll.getBoundingClientRect()
    return { content: element.clientWidth, available: scroll.clientWidth, padding: Number.parseFloat(style.paddingLeft), overflow: scroll.scrollWidth - scroll.clientWidth, left: rect.left - outer.left, right: outer.right - rect.right }
  })
  for (const width of [1600, 760]) {
    await session.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 860), width)
    await expect.poll(async () => (await geometry()).available - (await geometry()).content).toBe(64)
    const current = await geometry()
    expect(current.padding).toBe(0)
    expect(current.left).toBeCloseTo(32, 0)
    expect(current.right).toBeCloseTo(32, 0)
    expect(current.overflow).toBeLessThanOrEqual(1)
  }
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 860))
  await session.page.getByTestId('preferences-button').click()
  await expect(session.page.getByLabel('正文最大宽度')).toBeDisabled()
  await session.page.getByLabel('正文布局').selectOption('fixed')
  await session.page.getByLabel('正文最大宽度').fill('960')
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await expect.poll(async () => (await geometry()).content).toBe(896)
  await expect.poll(async () => JSON.parse(await readFile(path.join(session.userData, 'settings.json'), 'utf8')).preferences.contentWidthMode).toBe('fixed')
  await session.page.getByTestId('preferences-button').click()
  await session.page.getByLabel('正文布局').selectOption('auto')
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await expect.poll(async () => (await geometry()).available - (await geometry()).content).toBe(64)
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
    const line = element.querySelector('.cm-line')!.getBoundingClientRect()
    const gutter = scroller.querySelector('.cm-gutters')?.getBoundingClientRect().width ?? 0
    return { width: element.clientWidth, available: scroller.clientWidth, overflow: scroller.scrollWidth - scroller.clientWidth, left: rect.left - outer.left - gutter, right: outer.right - rect.right, lineLeft: line.left - outer.left - gutter, lineRight: outer.right - line.right }
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
  const sourceGeometry = await geometry()
  expect(Math.abs(sourceGeometry.lineLeft - sourceGeometry.lineRight)).toBeLessThan(2)
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect.poll(async () => (await geometry()).width).toBe(896)
  const constrained = await geometry()
  expect(constrained.left).toBeGreaterThan(100)
  expect(Math.abs(constrained.left - constrained.right)).toBeLessThan(2)
  expect(Math.abs(constrained.lineLeft - constrained.lineRight)).toBeLessThan(2)
  const selection = () => session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.selection.toJSON())
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.press('ControlOrMeta+End')
  const beforeSelection = await selection()
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await geometry()).available - (await geometry()).width).toBe(64)
  expect(await source()).toBe(original)
  expect(await selection()).toEqual(beforeSelection)
  await button.click()
  await expect.poll(async () => (await geometry()).width).toBe(896)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 860))
  await expect.poll(async () => (await geometry()).overflow).toBeLessThanOrEqual(1)
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
  await expect.poll(async () => {
    const current = await geometry()
    return current.width === Math.min(896, current.available)
  }).toBe(true)
  const narrow = await geometry()
  expect(Math.abs(narrow.lineLeft - narrow.lineRight)).toBeLessThan(2)
  const settingsFile = path.join(session.userData, 'settings.json')
  await expect.poll(async () => JSON.parse(await readFile(settingsFile, 'utf8')).preferences).toMatchObject({ contentWidthMode: 'fixed', contentWidth: 960 })
  const root = session.root
  await stopDesktop(session, false)
  session = await launchDesktop(root)
  await expect(session.page.getByTestId('content-width-toggle')).toHaveAttribute('aria-pressed', 'true')
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
  await expect.poll(async () => {
    const current = await geometry()
    return current.width === Math.min(896, current.available)
  }).toBe(true)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 860))
  await expect.poll(async () => (await geometry()).width).toBe(896)
  await captureDesktop(session, '.debug/content-width-fixed.png', { presentInactive: true })
})

test('标题没有下划线，聚焦标题及双击正文、列表和引用展开本行并可编辑、收起', async () => {
  const original = '# 一级标题\n\n## 二级标题\n\n普通 **粗体** 与 [链接](https://example.com)\n\n- 列表 **粗体**\n\n> 引用 **粗体**\n\n- [x] 完成事项\n\n结束\n'
  const file = await openFixture(session, 'line-editing.md', original)
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  await session.page.keyboard.press('ControlOrMeta+End')
  for (const level of [1, 2]) {
    const heading = editor.locator(`.cm-live-heading-${level}`)
    expect(await heading.evaluate(element => getComputedStyle(element).borderBottomWidth)).toBe('0px')
    expect(await heading.evaluate(element => [element, ...element.querySelectorAll('span')].some(node => getComputedStyle(node).textDecorationLine.includes('underline')))).toBe(false)
  }
  for (const lineNumber of [5, 7, 9, 11]) {
    const line = editor.locator(`.cm-line[data-source-line="${lineNumber}"]`)
    await line.dblclick()
    await expect(line).toHaveClass(/cm-live-edit-line/)
    await expect(line).toHaveText(original.split('\n')[lineNumber - 1])
    expect(await source()).toBe(original)
    await session.page.keyboard.press('Escape')
    await expect(editor.locator('.cm-live-edit-line')).toHaveCount(0)
  }
  await editor.locator('.cm-live-heading-2').click()
  await expect(editor.locator('.cm-line[data-source-line="3"]')).toHaveClass(/cm-live-edit-line/)
  await expect(editor.locator('.cm-line[data-source-line="3"]')).toHaveText('## 二级标题')
  await session.page.keyboard.press('End')
  await session.page.keyboard.insertText('已编辑')
  await editor.locator('.cm-line').filter({ hasText: /^结束$/ }).click()
  await expect(editor.locator('.cm-live-heading-2')).toHaveText('二级标题已编辑')
  await editor.locator('.cm-live-heading-1').click()
  await expect(editor.locator('.cm-line[data-source-line="1"]')).toHaveClass(/cm-live-edit-line/)
  await editor.locator('.cm-line').filter({ hasText: /^结束$/ }).click()
  await expect(editor.locator('.cm-live-edit-line')).toHaveCount(0)
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(original.replace('二级标题', '二级标题已编辑'))
})

test('图片等比放大且完整可见，双击图片、公式、图表和表格展开源码', async () => {
  await writeFile(path.join(session.root, 'small.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#53789a"/></svg>')
  await writeFile(path.join(session.root, 'portrait.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="2400"><rect width="600" height="2400" fill="#53789a"/></svg>')
  const original = '# 资源\n\n![小图片](small.svg)\n\n![竖图](portrait.svg)\n\n$$x^2$$\n\n```mermaid\ngraph LR\nA[开始] --> B[结束]\n```\n\n| Name | State |\n| --- | --- |\n| 原值 | 完成 |\n\n```js\nconst answer = 42\n```\n\n结束\n'
  const file = await openFixture(session, 'resources.md', original)
  await session.page.keyboard.press('ControlOrMeta+/')
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
  for (const selector of ['.md-math math', '.md-mermaid svg', '[data-testid="live-table"] tbody td:first-child']) {
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
  await session.page.keyboard.press('ControlOrMeta+e')
  await session.page.keyboard.insertText('新值')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(original.replace('原值', '新值'))
})


test('原生菜单选中光标所在词且不修改原文', async () => {
  const text = 'alpha bravo charlie'
  await openFixture(session, 'select-word.md', text)
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('Home')
  for (let i = 0; i < 8; i++) await session.page.keyboard.press('ArrowRight')
  await clickNativeMenu(session, '选中当前词')
  await expect.poll(() => editor.evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    const range = view.state.selection.main
    return view.state.doc.sliceString(range.from, range.to)
  })).toBe('bravo')
  expect(await source()).toBe(text)
})


test('原生菜单选择当前行并在文档和行边界间导航', async () => {
  const text = 'first line\nsecond line\nthird line'
  await openFixture(session, 'select-line.md', text)
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await clickNativeMenu(session, '跳转到文末')
  await clickNativeMenu(session, '跳转到行首')
  await clickNativeMenu(session, '选中当前行或句')
  const selection = () => editor.evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    const range = view.state.selection.main
    return { text: view.state.doc.sliceString(range.from, range.to), head: range.head }
  })
  await expect.poll(selection).toEqual({ text: 'third line', head: text.length })
  await clickNativeMenu(session, '跳转到文首')
  await expect.poll(selection).toEqual({ text: '', head: 0 })
  await clickNativeMenu(session, '跳转到行尾')
  await expect.poll(selection).toEqual({ text: '', head: 'first line'.length })
  expect(await source()).toBe(text)
})

test('段落菜单调整标题级别并支持撤销保存', async () => {
  const text = '前文\n\n## 标题\n\n后文'
  const destination = await openFixture(session, 'heading-level-menu.md', text)
  await session.page.keyboard.press('ControlOrMeta+/')
  await session.page.locator('.cm-line').filter({ hasText: '标题' }).click()
  await clickNativeMenu(session, '降低标题级别')
  await expect.poll(source).toBe('前文\n\n### 标题\n\n后文')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await clickNativeMenu(session, '提升标题级别')
  await expect.poll(source).toBe('前文\n\n# 标题\n\n后文')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe('前文\n\n# 标题\n\n后文')
})

test('段落菜单在代码块后插入正文并可撤销', async () => {
  const text = '前文\n\n```js\nconst x = 1\n```\n\n后文'
  const destination = await openFixture(session, 'insert-paragraph-menu.md', text)
  await session.page.keyboard.press('ControlOrMeta+/')
  await session.page.locator('.cm-live-code-body').click()
  await clickNativeMenu(session, '在下方插入段落')
  await expect.poll(source).toBe('前文\n\n```js\nconst x = 1\n```\n\n\n\n后文')
  await session.page.keyboard.insertText('新段落')
  await expect.poll(source).toBe('前文\n\n```js\nconst x = 1\n```\n\n新段落\n\n后文')
  await session.page.keyboard.press('ControlOrMeta+z')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe(text)
})

test('编辑菜单选择并删除完整代码块，撤销保留前后正文', async () => {
  const text = '前文\n\n```js\nconst x = 1\n```\n\n后文'
  await openFixture(session, 'delete-block-menu.md', text)
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  await editor.locator('.cm-live-code-body').click()
  await clickNativeMenu(session, '选中当前段落或块')
  await expect.poll(() => editor.evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    const range = view.state.selection.main
    return view.state.doc.sliceString(range.from, range.to)
  })).toBe('```js\nconst x = 1\n```')
  await clickNativeMenu(session, '删除当前块')
  await expect.poll(source).toBe('前文\n\n\n\n后文')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
})

test('任务状态菜单批量更新并可撤销', async () => {
  const text = '- [ ] one\n- [x] two\n- [ ] three'
  const destination = await openFixture(session, 'task-status-menu.md', text)
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '标记为已完成')
  await expect.poll(source).toBe('- [x] one\n- [x] two\n- [x] three')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe(text)
})

test('原生格式与段落菜单复用正文编辑并支持撤销', async () => {
  const text = 'hello world'
  const destination = await openFixture(session, 'native-format-menu.md', text)
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '加粗')
  await expect.poll(source).toBe('**hello world**')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await clickNativeMenu(session, '二级标题')
  await expect.poll(source).toBe('## hello world')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe('## hello world')
})

test('实时预览选择并删除当前句，撤销后原文恢复', async () => {
  const text = 'First sentence. Second sentence.'
  await openFixture(session, 'sentence-menu.md', text)
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('Home')
  for (let i = 0; i < 4; i++) await session.page.keyboard.press('ArrowRight')
  await clickNativeMenu(session, '选中当前行或句')
  await expect.poll(() => editor.evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    const range = view.state.selection.main
    return view.state.doc.sliceString(range.from, range.to)
  })).toBe('First sentence. ')
  await session.page.keyboard.press('ArrowLeft')
  await clickNativeMenu(session, '删除当前行或句')
  await expect.poll(source).toBe('Second sentence.')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
})

test('编辑菜单删除当前词并可撤销', async () => {
  const text = 'alpha bravo charlie'
  await openFixture(session, 'delete-word.md', text)
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.press('Home')
  for (let i = 0; i < 8; i++) await session.page.keyboard.press('ArrowRight')
  await clickNativeMenu(session, '删除当前词')
  await expect.poll(source).toBe('alpha  charlie')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
})

test('格式菜单下划线保持预览样式和 Markdown 原文并可撤销', async () => {
  const destination = await openFixture(session, 'underline-menu.md', 'hello world')
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '下划线')
  await expect.poll(source).toBe('<u>hello world</u>')
  await expect(editor.locator('.cm-live-underline')).toHaveText('hello world')
  await expect(editor).not.toContainText('<u>')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe('hello world')
  await clickNativeMenu(session, '下划线')
  await expect.poll(source).toBe('<u>hello world</u>')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe('<u>hello world</u>')
})

test('格式菜单高亮、上标、下标保留选区和撤销并遵守语法开关', async () => {
  const destination = await openFixture(session, 'extended-format-menu.md', '文字')
  await session.page.getByTestId('editor-mode').click()
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
  const editor = session.page.locator('.cm-content')
  for (const [label, expected] of [['高亮', '==文字=='], ['上标', '^文字^'], ['下标', '~文字~']] as const) {
    await editor.click()
    await session.page.keyboard.press('ControlOrMeta+a')
    await clickNativeMenu(session, label)
    await expect.poll(source).toBe(expected)
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe('文字')
  }
  await session.page.getByTestId('preferences-button').click()
  await session.page.getByLabel('高亮 ==文字==').uncheck()
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '高亮')
  await expect.poll(source).toBe('文字')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe('文字')
})

test('格式菜单行内数学对完整选区生效并可撤销，禁用时保留原文', async () => {
  const text = '\\alpha + x^2'
  const destination = await openFixture(session, 'inline-math-menu.md', text)
  await session.page.getByTestId('editor-mode').click()
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '行内数学')
  await expect.poll(source).toBe(`$${text}$`)
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await session.page.getByTestId('preferences-button').click()
  await session.page.getByLabel('行内数学', { exact: true }).uncheck()
  await session.page.getByRole('button', { name: '完成', exact: true }).click()
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '行内数学')
  await expect.poll(source).toBe(text)
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe(text)
})

test('格式菜单注释保留选中文本并可一次撤销', async () => {
  const destination = await openFixture(session, 'comment-menu.md', '保留文本')
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '注释')
  await expect.poll(source).toBe('<!--保留文本-->')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe('保留文本')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe('保留文本')
})

test('清除格式保留代码围栏，并可撤销普通强调文本修改', async () => {
  const code = '```\n**keep**\n```'
  const file = await openFixture(session, 'clear-format-code.md', code)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') !== 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '清除格式')
  expect(await source()).toBe(code)
  await setContextMenuChoice(session, 'clear-format')
  await editor.locator('.cm-line').nth(1).click({ button: 'right' })
  expect(await source()).toBe(code)
  expect(await readFile(file, 'utf8')).toBe(code)
  const text = '**bold** and *italic*'
  await openFixture(session, 'clear-format-text.md', text)
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '清除格式')
  await expect.poll(source).toBe('bold and italic')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  const mixed = '# **标题**\n\n- [ ] 任务\n\n[链接](https://example.com) and `code`'
  await openFixture(session, 'clear-format-structures.md', mixed)
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '清除格式')
  await expect.poll(source).toBe('标题\n\n任务\n\n链接 and code')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(mixed)
})

test('清除格式保留共享引用定义并安全处理嵌套列表', async () => {
  const list = '- parent\n  - child\n    continuation'
  const file = await openFixture(session, 'clear-nested-list.md', list)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') !== 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '清除格式')
  await expect.poll(source).toBe('parent\nchild\ncontinuation')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(list)
  expect(await readFile(file, 'utf8')).toBe(list)
  const text = '[first][ref] and [second][ref]\n\n[ref]: /target'
  await openFixture(session, 'clear-reference.md', text)
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+Home')
  for (let i = 0; i < '[first][ref]'.length; i++) await session.page.keyboard.press('Shift+ArrowRight')
  await clickNativeMenu(session, '清除格式')
  await expect.poll(source).toBe('first and [second][ref]\n\n[ref]: /target')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  const unresolved = '[plain] and [first][missing] and \\[escaped\\]'
  const unresolvedFile = await openFixture(session, 'clear-unresolved-reference.md', unresolved)
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '清除格式')
  expect(await source()).toBe(unresolved)
  expect(await readFile(unresolvedFile, 'utf8')).toBe(unresolved)
})

test('段落格式命令不改选区内的代码块，普通标题仍可转换及撤销', async () => {
  const text = '# heading\n\n```js\n# keep\n- item\n```\n\nafter'
  const file = await openFixture(session, 'format-code-protection.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') !== 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  for (const label of ['正文', '一级标题', '无序列表', '引用']) {
    await clickNativeMenu(session, label)
    expect(await source()).toBe(text)
  }
  await session.page.keyboard.press('ControlOrMeta+Home')
  await session.page.keyboard.press('Shift+End')
  await clickNativeMenu(session, '正文')
  await expect.poll(source).toBe('heading\n\n```js\n# keep\n- item\n```\n\nafter')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('段落格式命令保留表格、HTML 块和引用定义', async () => {
  const text = '---\n- key: value\n---\n\nbefore\n\n$$\n# keep\n$$\n\n| a | b |\n|---|---|\n| c | d |\n\n<div>\n# keep\n</div>\n\n[ref]: /target\n\nafter'
  const file = await openFixture(session, 'format-structured-protection.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') !== 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  for (const label of ['正文', '一级标题', '无序列表', '引用']) {
    await clickNativeMenu(session, label)
    expect(await source()).toBe(text)
  }
  await clickNativeMenu(session, '清除格式')
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
  for (const [name, block] of [['yaml-format-guard.md', '---\n- key: **value**\n---'], ['math-format-guard.md', '$$\n# **keep**\n$$']]) {
    await openFixture(session, name, block)
    await editor.click()
    await session.page.keyboard.press('ControlOrMeta+a')
    await clickNativeMenu(session, '正文')
    await clickNativeMenu(session, '清除格式')
    expect(await source()).toBe(block)
  }
})

test('行内格式不破坏跨代码块选区且代码仍可编辑', async () => {
  const text = 'text\n\n```js\nconst value = 1\n```\n\nafter'
  const file = await openFixture(session, 'inline-code-protection.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') !== 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  for (const label of ['加粗', '斜体', '删除线', '行内代码', '插入链接']) {
    await clickNativeMenu(session, label)
    expect(await source()).toBe(text)
  }
  await session.page.keyboard.press('ControlOrMeta+Home')
  await session.page.keyboard.press('Shift+End')
  await clickNativeMenu(session, '加粗')
  await expect.poll(source).toBe('**text**\n\n```js\nconst value = 1\n```\n\nafter')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await editor.locator('.cm-line').filter({ hasText: 'const value = 1' }).click()
  await session.page.keyboard.press('End')
  await session.page.keyboard.type(';')
  await expect.poll(source).toContain('const value = 1;')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('行内代码格式保留选区中的反引号并可切换和撤销', async () => {
  const text = 'a`b'
  const file = await openFixture(session, 'inline-code-delimiters.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') !== 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '行内代码')
  await expect.poll(source).toBe('``a`b``')
  await clickNativeMenu(session, '行内代码')
  await expect.poll(source).toBe(text)
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe('``a`b``')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('插入链接保留方括号文字和现有转义并可撤销', async () => {
  const text = 'a]b'
  const file = await openFixture(session, 'link-brackets.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') !== 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '插入链接')
  await expect.poll(source).toBe('[a\\]b](https://example.com)')
  await expect.poll(() => editor.evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
  })).toBe('https://example.com')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('粗斜体保留边缘空格并避开冲突定界符', async () => {
  const editor = session.page.locator('.cm-content')
  const italic = ' text '
  const file = await openFixture(session, 'emphasis-space.md', italic)
  if (await editor.getAttribute('data-mode') !== 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '斜体')
  await expect.poll(source).toBe(' *text* ')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(italic)
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '删除线')
  await expect.poll(source).toBe(' ~~text~~ ')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(italic)
  expect(await readFile(file, 'utf8')).toBe(italic)
  await openFixture(session, 'emphasis-delimiter.md', 'a**b')
  await editor.click()
  await session.page.keyboard.press('ControlOrMeta+a')
  await clickNativeMenu(session, '加粗')
  await expect.poll(source).toBe('__a**b__')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe('a**b')
})

test('专注模式保持同一普通段落的所有源行清晰', async () => {
  const text = 'first line\nsecond line\n\nother paragraph'
  const file = await openFixture(session, 'focus-paragraph.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await editor.locator('.cm-line').filter({ hasText: 'first line' }).click()
  await clickNativeMenu(session, '专注模式')
  await expect(editor.locator('.cm-line').filter({ hasText: 'other paragraph' })).toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'first line' })).not.toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'second line' })).not.toHaveClass(/cm-focus-muted/)
  await session.page.keyboard.press('End')
  await session.page.keyboard.type('!')
  await expect.poll(source).toContain('first line!')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await expect(editor.locator('.cm-line').filter({ hasText: 'second line' })).not.toHaveClass(/cm-focus-muted/)
  await editor.locator('.cm-line').filter({ hasText: 'other paragraph' }).click()
  await expect(editor.locator('.cm-line').filter({ hasText: 'first line' })).toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'second line' })).toHaveClass(/cm-focus-muted/)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('专注模式保持引用和列表内同段落的源行清晰', async () => {
  const text = '> quote first\n> quote second\n\n- item first\n  item second\n- sibling first\n  sibling second\n\nafter'
  const file = await openFixture(session, 'focus-container-paragraph.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.locator('.cm-line').filter({ hasText: 'quote first' }).click()
  await clickNativeMenu(session, '专注模式')
  await expect(editor.locator('.cm-line').filter({ hasText: 'after' })).toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'quote first' })).not.toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'quote second' })).not.toHaveClass(/cm-focus-muted/)
  await editor.locator('.cm-line').filter({ hasText: 'item first' }).click()
  await expect(editor.locator('.cm-line').filter({ hasText: 'quote first' })).toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'item first' })).not.toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'item second' })).not.toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'sibling first' })).toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'sibling second' })).toHaveClass(/cm-focus-muted/)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('专注模式保持当前任务项的续行清晰', async () => {
  const text = '- [ ] task first\n  task second\n- [x] sibling task\n  sibling continuation'
  const file = await openFixture(session, 'focus-task-paragraph.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await editor.locator('.cm-line').filter({ hasText: 'task first' }).click()
  await clickNativeMenu(session, '专注模式')
  await expect(editor.locator('.cm-line').filter({ hasText: 'sibling task' })).toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'task first' })).not.toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'task second' })).not.toHaveClass(/cm-focus-muted/)
  await expect(editor.locator('.cm-line').filter({ hasText: 'sibling continuation' })).toHaveClass(/cm-focus-muted/)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('专注模式按代码块焦点及活动行淡化代码', async () => {
  const text = 'paragraph\n\n```js\nfirstCode()\nsecondCode()\n```\n\nafter'
  const file = await openFixture(session, 'focus-code.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await editor.locator('.cm-line').filter({ hasText: 'paragraph' }).click()
  await clickNativeMenu(session, '专注模式')
  await expect(editor.locator('.cm-line').filter({ hasText: 'after' })).toHaveClass(/cm-focus-muted/)
  const first = editor.locator('.cm-live-code-body').filter({ hasText: 'firstCode' })
  const second = editor.locator('.cm-live-code-body').filter({ hasText: 'secondCode' })
  await expect(first).toHaveClass(/cm-code-focus-muted/)
  await expect(second).toHaveClass(/cm-code-focus-muted/)
  expect(await first.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  await second.click()
  await expect(first).toHaveClass(/cm-code-focus-muted/)
  await expect(second).not.toHaveClass(/cm-code-focus-muted/)
  const firstStyle = await first.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element, '::after').backgroundColor }))
  const secondStyle = await second.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element, '::after').backgroundColor }))
  expect(firstStyle.color).not.toBe(secondStyle.color)
  expect(firstStyle.background).toBe(secondStyle.background)
  expect(await session.page.locator('.cm-selectionLayer').evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  await session.page.keyboard.press('End')
  await session.page.keyboard.type(';')
  await expect.poll(source).toContain('secondCode();')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await session.page.getByLabel('筛选标题').focus()
  await expect(second).toHaveClass(/cm-code-focus-muted/)
  await clickNativeMenu(session, '专注模式')
  await expect(first).not.toHaveClass(/cm-code-focus-muted/)
  await expect(second).not.toHaveClass(/cm-code-focus-muted/)
  await second.click()
  await clickNativeMenu(session, '专注模式')
  await expect(first).toHaveClass(/cm-code-focus-muted/)
  await expect(second).not.toHaveClass(/cm-code-focus-muted/)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('专注模式淡化非活动公式预览且关闭后恢复', async () => {
  const text = 'paragraph\n\n$$\nx^2\n$$\n\nafter'
  const file = await openFixture(session, 'focus-math.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await editor.locator('.cm-line').filter({ hasText: 'paragraph' }).click()
  const math = editor.locator('.cm-live-block').filter({ has: session.page.locator('.md-math') })
  await expect(math).toBeVisible()
  await math.evaluate(element => Reflect.set(window, 'focusMathOriginal', element))
  await clickNativeMenu(session, '专注模式')
  await expect(editor.locator('.cm-line').filter({ hasText: 'after' })).toHaveClass(/cm-focus-muted/)
  await expect(math).toHaveClass(/cm-focus-muted/)
  expect(await math.evaluate(element => element === Reflect.get(window, 'focusMathOriginal'))).toBe(true)
  await math.getByRole('button', { name: '编辑公式' }).click()
  const sourceLine = editor.locator('.cm-live-edit-block').filter({ hasText: 'x^2' })
  await expect(sourceLine).toBeVisible()
  await sourceLine.click()
  await session.page.keyboard.press('End')
  await session.page.keyboard.type('+1')
  await expect.poll(source).toContain('x^2+1')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
  await session.page.keyboard.press('Escape')
  await expect(math).toBeVisible()
  await clickNativeMenu(session, '专注模式')
  await expect(math).not.toHaveClass(/cm-focus-muted/)
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('专注模式淡化非活动独占图片且关闭后恢复', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVj8AAAAASUVORK5CYII='
  const text = `paragraph\n\n![图片](${png})\n\nafter`
  const file = await openFixture(session, 'focus-image.md', text)
  const editor = session.page.locator('.cm-content')
  if (await editor.getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  await editor.locator('.cm-line').filter({ hasText: 'paragraph' }).click()
  const image = editor.locator('.cm-live-block img')
  await expect(image).toBeVisible()
  await image.evaluate(element => Reflect.set(window, 'focusImageOriginal', element))
  await clickNativeMenu(session, '专注模式')
  await expect(editor.locator('.cm-line').filter({ hasText: 'after' })).toHaveClass(/cm-focus-muted/)
  await expect.poll(() => image.evaluate(element => getComputedStyle(element).opacity)).toBe('0.2')
  expect(await image.evaluate(element => element === Reflect.get(window, 'focusImageOriginal'))).toBe(true)
  const edit = editor.getByRole('button', { name: '编辑此块' })
  await edit.focus()
  await expect(edit).toBeFocused()
  await edit.click()
  await expect(editor.locator('.cm-live-edit-block')).toHaveCount(1)
  await session.page.keyboard.press('Escape')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  await clickNativeMenu(session, '专注模式')
  await expect.poll(() => image.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
  expect(await source()).toBe(text)
  expect(await readFile(file, 'utf8')).toBe(text)
})

test('段落菜单插入内容目录并可撤销', async () => {
  const text = '# 第一章\n\n正文'
  await openFixture(session, 'insert-toc-menu.md', text)
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  await editor.locator('.cm-line').filter({ hasText: '正文' }).click()
  await clickNativeMenu(session, '内容目录')
  await expect.poll(source).toContain('[toc]')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
})

test('段落菜单插入脚注引用与定义并可撤销', async () => {
  const text = '正文'
  await openFixture(session, 'footnote-menu.md', text)
  await session.page.keyboard.press('ControlOrMeta+/')
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.press('End')
  await clickNativeMenu(session, '脚注')
  await expect.poll(source).toBe('正文[^fn1]\n\n[^fn1]: ')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(source).toBe(text)
})
