import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, readCreatedText, setSaveDialog, stopDesktop, type DesktopSession } from './desktop-helpers'

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

test('ONB 十二个分组默认收起，点击或键盘展开正文且不修改原文', async () => {
  const groups = Array.from({ length: 12 }, (_, index) => {
    const id = String(index + 1).padStart(2, '0')
    return `<details>\n<summary>ONB-${id} · 测试分组</summary>\n\n#### ONB-${id}-01\n\n正文-${id} **粗体**\n\n1. 操作-${id}\n\n${index === 0 ? '```js\nconst answer = 42;\n```\n\n| 项目 | 值 |\n| --- | --- |\n| 状态 | 完成 |\n\n' : ''}</details>`
  })
  const original = '# 引导用例\n\n' + groups.join('\n\n') + '\n\n分组后的正文\n'
  const file = await openFixture(session, 'onb-details.md', original)
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  const disclosures = editor.locator('details')
  await expect(disclosures).toHaveCount(12)
  for (let index = 0; index < 12; index++) {
    const disclosure = disclosures.nth(index)
    await expect(disclosure).not.toHaveAttribute('open')
    await expect(disclosure.getByText(`正文-${String(index + 1).padStart(2, '0')}`, { exact: false })).toBeHidden()
  }
  await expect(editor.getByRole('combobox', { name: '代码块语言' })).toHaveCount(0)
  const first = disclosures.first()
  await first.locator(':scope > summary').click()
  await expect(first.getByRole('heading', { name: 'ONB-01-01', exact: true })).toBeVisible()
  await expect(first.locator('pre')).toHaveText('const answer = 42;\n')
  await expect(first.locator('table')).toBeVisible()
  await expect(disclosures.nth(1).getByText('正文-02', { exact: false })).toBeHidden()
  await first.locator(':scope > summary').click()
  await expect(first.getByRole('heading', { name: 'ONB-01-01', exact: true })).toBeHidden()
  const last = disclosures.last()
  await last.locator(':scope > summary').focus()
  await session.page.keyboard.press('Space')
  await expect(last.getByText('正文-12', { exact: false })).toBeVisible()
  await session.page.keyboard.press('Space')
  await expect(last.getByText('正文-12', { exact: false })).toBeHidden()
  expect(await source()).toBe(original)
  await expect(session.page.getByTestId('dirty-indicator')).toHaveCount(0)
  expect(await readFile(file, 'utf8')).toBe(original)
  await session.page.screenshot({ path: '.debug/details-collapsed.png' })
})

test('嵌套分组独立折叠，显式 open 属性在预览和导出中保留，未闭合正文仍可见', async () => {
  const original = '<details>\n<summary>外层分组</summary>\n\n外层正文\n\n<details>\n<summary>内层分组</summary>\n\n内层正文\n\n</details>\n\n</details>\n\n<details open ontoggle="window.unsafeDisclosure = true">\n<summary>默认展开</summary>\n\n默认可见正文\n\n</details>\n\n<details>\n<summary>尚未完成</summary>\n\n未闭合正文\n'
  await openFixture(session, 'nested-details.md', original)
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  const outer = editor.locator('details').first()
  const inner = outer.locator('details')
  await expect(inner.getByText('内层正文', { exact: true })).toBeHidden()
  await outer.locator(':scope > summary').click()
  await expect(outer.getByText('外层正文', { exact: true })).toBeVisible()
  await expect(inner.getByText('内层正文', { exact: true })).toBeHidden()
  await inner.locator(':scope > summary').click()
  await expect(inner.getByText('内层正文', { exact: true })).toBeVisible()
  await outer.locator(':scope > summary').click()
  await expect(inner.getByText('内层正文', { exact: true })).toBeHidden()
  const opened = editor.locator('details').filter({ hasText: '默认可见正文' })
  await expect(opened).toHaveAttribute('open', '')
  await expect(opened).not.toHaveAttribute('ontoggle')
  await expect(editor.getByText('默认可见正文', { exact: true })).toBeVisible()
  await expect(editor.getByText('未闭合正文', { exact: true })).toBeVisible()
  expect(await source()).toBe(original)

  const exported = path.join(session.root, 'details.html')
  await setSaveDialog(session, exported)
  await session.page.getByTestId('export-menu').click()
  await session.page.getByTestId('export-html').click()
  await expect.poll(async () => (await readCreatedText(exported)).length).toBeGreaterThan(0)
  const state = await session.page.evaluate(markup => {
    const document = new DOMParser().parseFromString(markup, 'text/html')
    return Array.from(document.querySelectorAll('details')).map(details => ({ open: details.open, summary: details.querySelector(':scope > summary')?.textContent, unsafe: details.hasAttribute('ontoggle') }))
  }, await readFile(exported, 'utf8'))
  expect(state.slice(0, 3)).toEqual([
    { open: false, summary: '外层分组', unsafe: false },
    { open: false, summary: '内层分组', unsafe: false },
    { open: true, summary: '默认展开', unsafe: false },
  ])
})

test('双击折叠标题展开完整 Markdown 源码，修改后恢复折叠并准确保存', async () => {
  const original = '<details>\n<summary>可编辑分组</summary>\n\n#### 子标题\n\n正文 **原值**\n\n</details>\n\n后文\n'
  const file = await openFixture(session, 'editable-details.md', original)
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  await editor.locator('summary').dblclick()
  await expect(editor.locator('.cm-live-edit-block').first()).toHaveText('<details>')
  await expect(editor.locator('.cm-live-edit-block').last()).toHaveText('</details>')
  const line = editor.locator('.cm-live-edit-block').filter({ hasText: /^正文 \*\*原值\*\*$/ })
  await line.click()
  await session.page.keyboard.press('Home')
  await session.page.keyboard.press('Shift+End')
  await session.page.keyboard.insertText('正文 **新值**')
  await session.page.keyboard.press('Escape')
  await expect(editor.locator('details')).not.toHaveAttribute('open')
  await expect(editor.getByText('新值', { exact: true })).toBeHidden()
  await editor.locator('summary').click()
  await expect(editor.getByText('新值', { exact: true })).toBeVisible()
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(original.replace('原值', '新值'))
  expect(await source()).toBe(original.replace('原值', '新值'))
})
