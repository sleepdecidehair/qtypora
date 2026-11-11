import { test, expect } from '@playwright/test'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captureDesktop, launchDesktop, openFixture, setOpenDialog, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession

test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  if (!session) return
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

async function preview(): Promise<void> {
  if (await session.page.locator('.cm-content').getAttribute('data-mode') === 'source') await session.page.keyboard.press('ControlOrMeta+/')
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'hybrid')
}

async function editorState() {
  return session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return { source: view.state.doc.toString(), selection: view.state.selection.toJSON(), top: view.scrollDOM.scrollTop }
  })
}

test('悬停重复脚注显示多段格式正文，保留坐标、选区与保存原文', async () => {
  const content = '开头段落。\r\n\r\n'.repeat(3) + '正文[^note]，再次引用[^note]。\r\n\r\n' + '保持滚动位置。\r\n\r\n'.repeat(35) + '[^note]: 第一行 **加粗** 与 `代码`\r\n\r\n    第二段 *斜体*。\r\n'
  const file = await openFixture(session, 'hover-footnote.md', content)
  await preview()
  await session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    const anchor = view.state.doc.toString().indexOf('正文')
    view.dispatch({ selection: { anchor, head: anchor + 2 } })
    view.scrollDOM.scrollTop = 12
  })
  const references = session.page.locator('.cm-live-footnote')
  await expect(references).toHaveCount(2)
  await session.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const before = await editorState()
  expect(before.top).toBeGreaterThan(0)
  const referenceBox = await references.first().boundingBox()
  await references.first().hover()
  const tooltip = session.page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('strong')).toHaveText('加粗')
  await expect(tooltip.locator('code')).toHaveText('代码')
  await expect(tooltip.locator('em')).toHaveText('斜体')
  await expect(tooltip.locator('p')).toHaveCount(2)
  await expect(tooltip).toBeInViewport()
  expect(await editorState()).toEqual(before)
  const box = await tooltip.boundingBox()
  expect(referenceBox && box && box.width > 100 && box.height > 30).toBeTruthy()
  const viewport = await session.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  expect(Math.min(Math.abs(box!.y - referenceBox!.y - referenceBox!.height), Math.abs(box!.y + box!.height - referenceBox!.y))).toBeLessThan(25)
  await captureDesktop(session, path.join(test.info().outputDir, 'footnote-hover.png'))
  await session.page.mouse.move(0, 0)
  await expect(tooltip).toHaveCount(0)
  await references.nth(1).hover()
  await expect(tooltip).toContainText('第二段')
  expect(await editorState()).toEqual(before)
  await session.page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await references.first().hover()
  await expect(tooltip).toBeVisible()
  await session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight
  })
  await expect(tooltip).toHaveCount(0)
  await session.page.locator('.cm-content').evaluate((element, top) => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    view.scrollDOM.scrollTop = top
  }, before.top)
  await references.first().hover()
  await expect(tooltip).toContainText('第二段')
  expect(await editorState()).toEqual(before)
  await session.page.keyboard.press('Escape')
  await session.page.keyboard.press('ControlOrMeta+s')
  expect(await readFile(file, 'utf8')).toBe(content)
})

test('悬停后点击仍跳转，编辑定义和切换文档清除旧预览', async () => {
  const content = '正文[^note]。\n\n' + '间隔段落。\n\n'.repeat(35) + '[^note]: 原脚注 **正文**\n'
  const file = await openFixture(session, 'hover-edit.md', content)
  await preview()
  const reference = session.page.locator('.cm-live-footnote')
  await reference.hover()
  await expect(session.page.getByRole('tooltip')).toContainText('原脚注')
  await reference.click()
  await expect(session.page.getByRole('tooltip')).toHaveCount(0)
  const block = session.page.locator('.cm-live-block').filter({ has: session.page.locator('.md-footnote-definition') })
  await expect(block).toBeInViewport()
  expect((await editorState()).top).toBeGreaterThan(100)
  await block.getByRole('button', { name: '编辑此块' }).click()
  await session.page.keyboard.press('End')
  await session.page.keyboard.insertText(' 已更新')
  await session.page.keyboard.press('Escape')
  await session.page.keyboard.press('ControlOrMeta+Home')
  await reference.hover()
  await expect(session.page.getByRole('tooltip')).toContainText('已更新')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(content.replace('**正文**', '**正文** 已更新'))
  await openFixture(session, 'hover-next.md', '新文档[^note]。\n\n[^note]: 新的定义\n')
  await expect(session.page.getByRole('tooltip')).toHaveCount(0)
  await session.page.locator('.cm-live-footnote').hover()
  await expect(session.page.getByRole('tooltip')).toContainText('新的定义')
  await expect(session.page.getByRole('tooltip')).not.toContainText('已更新')
})

test('源码、未定义引用和禁用脚注时不会出现预览', async () => {
  const content = '正常[^note]，未定义[^missing]，`代码[^note]`。\n\n[^note]: 有效定义\n'
  await openFixture(session, 'hover-disabled.md', content)
  await session.page.locator('.cm-line').filter({ hasText: '未定义' }).hover()
  await expect(session.page.getByRole('tooltip')).toHaveCount(0)
  await preview()
  await expect(session.page.locator('.cm-live-footnote')).toHaveCount(1)
  const line = session.page.locator('.cm-line').filter({ hasText: '未定义' })
  const box = await line.boundingBox()
  await session.page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2)
  await expect(session.page.getByRole('tooltip')).toHaveCount(0)
  await session.page.evaluate(async () => {
    const result = await window.desktop.bootstrap()
    if (!result.ok) throw new Error(result.error.message)
    const updated = await window.desktop.updatePreferences({ ...result.data.preferences, markdown: { ...result.data.preferences.markdown, footnotes: false } })
    if (!updated.ok) throw new Error(updated.error.message)
  })
  await expect(session.page.locator('.cm-live-footnote')).toHaveCount(0)
  await line.hover()
  await expect(session.page.getByRole('tooltip')).toHaveCount(0)
})

test('悬停正文不带重复身份、回链或可加载的媒体', async () => {
  const content = '正文[^safe]。\n\n[^safe]: **安全正文** <span id="duplicate">标识</span> ![远程图片](https://example.com/hover.png)\n\n    <video src="https://example.com/hover.mp4"></video>\n\n    <script>window.footnoteHoverUnsafe = true</script>\n'
  const requests: string[] = []
  await session.page.route('https://example.com/**', async route => { requests.push(route.request().url()); await route.abort() })
  await openFixture(session, 'hover-safe.md', content)
  await preview()
  await expect(session.page.locator('.cm-live-block')).toContainText('安全正文')
  await expect.poll(() => session.page.locator('.cm-live-block img[data-resource], .cm-live-block video[data-resource]').count()).toBe(0)
  await expect.poll(() => requests.length).toBe(2)
  const count = requests.length
  await session.page.locator('.cm-live-footnote').hover()
  const tooltip = session.page.getByRole('tooltip')
  await expect(tooltip).toContainText('安全正文')
  await expect(tooltip).toContainText('远程图片')
  await expect(tooltip.locator('[id], [name], .footnote-backref, img, audio, video, iframe, source, script, [data-resource], button')).toHaveCount(0)
  expect(requests).toHaveLength(count)
  expect(await session.page.evaluate(() => Reflect.get(window, 'footnoteHoverUnsafe'))).toBeUndefined()
})

test('只读脚注支持鼠标和键盘预览，保持源文档不可编辑', async () => {
  const file = path.join(session.root, 'hover-readonly.md')
  const content = '只读正文[^note]。\n\n[^note]: 只读脚注\n'
  await writeFile(file, content)
  await chmod(file, 0o444)
  try {
    await setOpenDialog(session, [file])
    await session.page.keyboard.press('ControlOrMeta+o')
    await expect(session.page).toHaveTitle(/hover-readonly\.md/)
    await expect(session.page.locator('.document-heading')).toContainText('只读')
    await preview()
    const reference = session.page.locator('.cm-live-footnote')
    await reference.hover()
    await expect(session.page.getByRole('tooltip')).toContainText('只读脚注')
    await session.page.mouse.move(0, 0)
    await expect(session.page.getByRole('tooltip')).toHaveCount(0)
    await reference.focus()
    await expect(session.page.getByRole('tooltip')).toContainText('只读脚注')
    await expect(reference).toHaveAttribute('aria-describedby', /\S+/)
    await session.page.keyboard.press('Escape')
    await expect(session.page.getByRole('tooltip')).toHaveCount(0)
    await session.page.keyboard.press('Enter')
    const block = session.page.locator('.cm-live-block').filter({ has: session.page.locator('.md-footnote-definition') })
    await expect(block).toBeInViewport()
    await expect(block.getByRole('button', { name: '编辑此块' })).toHaveCount(0)
    expect(await readFile(file, 'utf8')).toBe(content)
  } finally { await chmod(file, 0o666) }
})
