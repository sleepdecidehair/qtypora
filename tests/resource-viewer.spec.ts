import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, openFixture, setContextMenuChoice, setMessageResponse, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  if (!session) return
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors, 'No unhandled renderer errors').toEqual([])
})

async function viewportGeometry() {
  return session.page.getByTestId('resource-stage').evaluate(stage => {
    const content = stage.querySelector<HTMLElement>('.editor-resource-content')!
    const transform = new DOMMatrix(getComputedStyle(content).transform)
    const image = content.getBoundingClientRect(), area = stage.getBoundingClientRect()
    return { scale: transform.a, x: transform.e, y: transform.f, width: stage.clientWidth, height: stage.clientHeight,
      full: image.left >= area.left - 1 && image.right <= area.right + 1 && image.top >= area.top - 1 && image.bottom <= area.bottom + 1 }
  })
}

async function articleState() {
  return session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return { source: view.state.doc.toString(), selection: view.state.selection.toJSON(), top: view.scrollDOM.scrollTop, mode: element.getAttribute('data-mode'), focused: view.hasFocus }
  })
}

test('大图片按鼠标位置缩放、拖动、恢复全图，关闭保留文章和滚动位置', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800"><rect width="2400" height="1800" fill="#f4f6fb"/><text x="900" y="800" font-size="32">可读的局部细节</text></svg>'
  await writeFile(path.join(session.root, 'large.svg'), svg)
  const source = '# 图片查看\n\n前文。\n\n![大图片](large.svg)\n\n' + '查看完成后保持文章位置。\n\n'.repeat(30)
  const file = await openFixture(session, 'resource-image.md', source)
  await session.page.keyboard.press('ControlOrMeta+/')
  const original = session.page.getByRole('img', { name: '大图片', exact: true })
  await original.scrollIntoViewIfNeeded()
  const before = await articleState()
  await setContextMenuChoice(session, 'view-resource')
  await original.click({ button: 'right' })
  const viewer = session.page.getByTestId('resource-viewer')
  await expect(viewer).toBeVisible()
  await expect.poll(async () => (await viewportGeometry()).full).toBe(true)
  const fitted = await viewportGeometry()
  await viewer.getByRole('button', { name: '原始大小', exact: true }).click()
  await expect.poll(async () => (await viewportGeometry()).scale).toBe(1)
  const stage = session.page.getByTestId('resource-stage')
  const box = (await stage.boundingBox())!
  const anchor = { x: Math.round(box.x + box.width * 0.45) - box.x, y: Math.round(box.y + box.height * 0.45) - box.y }
  const previous = await viewportGeometry()
  await session.page.mouse.move(box.x + anchor.x, box.y + anchor.y)
  await session.page.mouse.wheel(0, -250)
  await expect.poll(async () => (await viewportGeometry()).scale).toBeGreaterThan(1)
  const zoomed = await viewportGeometry()
  expect((anchor.x - zoomed.x) / zoomed.scale).toBeCloseTo((anchor.x - previous.x) / previous.scale, 2)
  expect((anchor.y - zoomed.y) / zoomed.scale).toBeCloseTo((anchor.y - previous.y) / previous.scale, 2)
  await session.page.mouse.down()
  await session.page.mouse.move(box.x + anchor.x + 110, box.y + anchor.y + 70, { steps: 5 })
  await session.page.mouse.up()
  const moved = await viewportGeometry()
  expect(moved.x - zoomed.x).toBeCloseTo(110, 0)
  expect(moved.y - zoomed.y).toBeCloseTo(70, 0)
  await session.page.screenshot({ path: test.info().outputPath('image-detail.png') })
  // Native menu accelerators must also be isolated from the article behind the modal.
  await session.page.keyboard.press('ControlOrMeta+/')
  await session.page.keyboard.press('ControlOrMeta+Shift+=')
  expect((await articleState()).mode).toBe('hybrid')
  await viewer.getByRole('button', { name: '适应窗口', exact: true }).click()
  await expect.poll(async () => (await viewportGeometry()).scale).toBeCloseTo(fitted.scale, 5)
  expect((await viewportGeometry()).full).toBe(true)
  await session.page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  const after = await articleState()
  expect(after.source).toBe(before.source)
  expect(after.selection).toEqual(before.selection)
  expect(after.top).toBeCloseTo(before.top, 0)
  expect(after.focused).toBe(true)
  expect(await readFile(file, 'utf8')).toBe(source)
  expect(await readFile(path.join(session.root, 'large.svg'), 'utf8')).toBe(svg)
})

test('Mermaid与公式查看支持键盘缩放、窗口改变、焦点循环及重新打开复位', async () => {
  const source = '# 图表细节\n\n```mermaid\nflowchart TB\nA[开始] --> B[处理] --> C[核对] --> D[结束]\n```\n\n$$\nx^2+y^2=z^2\n$$\n'
  const file = await openFixture(session, 'resource-diagram.md', source)
  await session.page.keyboard.press('ControlOrMeta+/')
  const diagram = session.page.locator('.md-mermaid svg')
  await expect(diagram).toBeVisible()
  await setContextMenuChoice(session, 'view-resource')
  await diagram.click({ button: 'right' })
  const viewer = session.page.getByTestId('resource-viewer')
  await expect(viewer.getByRole('img', { name: '完整图表' })).toBeVisible()
  await session.page.keyboard.press('1')
  await session.page.keyboard.press('+')
  await expect.poll(async () => (await viewportGeometry()).scale).toBe(1.25)
  await session.page.keyboard.press('-')
  await expect.poll(async () => (await viewportGeometry()).scale).toBe(1)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await expect.poll(async () => (await viewportGeometry()).width).toBeLessThan(900)
  expect((await viewportGeometry()).scale).toBe(1)
  await session.page.keyboard.press('0')
  await expect.poll(async () => (await viewportGeometry()).full).toBe(true)
  await viewer.getByRole('button', { name: '关闭资源查看' }).evaluate(button => button.blur())
  await session.page.keyboard.press('Shift+Tab')
  await expect(viewer.getByRole('button', { name: '关闭资源查看' })).toBeFocused()
  for (let i = 0; i < 7; i++) {
    await session.page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
    expect(await viewer.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await viewer.getByRole('button', { name: '关闭资源查看' }).click()
  await session.page.locator('.md-math').click({ button: 'right' })
  await expect(viewer.locator('math')).toBeVisible()
  await session.page.keyboard.press('+')
  await expect.poll(async () => (await viewportGeometry()).scale).toBe(1.25)
  await session.page.keyboard.press('Escape')
  await session.page.locator('.md-math').click({ button: 'right' })
  await expect.poll(async () => (await viewportGeometry()).scale).toBe(1)
  await session.page.mouse.click(2, 2)
  await expect(viewer).toHaveCount(0)
  expect((await articleState()).source).toBe(source)
  expect(await readFile(file, 'utf8')).toBe(source)
})

test('损坏图片显示加载失败，禁用缩放，仍可键盘关闭并继续编辑', async () => {
  await writeFile(path.join(session.root, 'broken.png'), Buffer.from('not an image'))
  const file = await openFixture(session, 'broken-resource.md', '# 损坏图片\n\n![损坏图片](broken.png)\n')
  await setContextMenuChoice(session, 'view-resource')
  // Hit the image syntax itself; the blank space after a source line has a document context.
  const hit = await session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    const rect = view.coordsAtPos(view.state.doc.line(3).from + 5)!
    return { x: rect.left + 1, y: (rect.top + rect.bottom) / 2 }
  })
  await session.page.mouse.click(hit.x, hit.y, { button: 'right' })
  const viewer = session.page.getByTestId('resource-viewer')
  await expect(viewer.getByRole('status').filter({ hasText: '资源加载失败' })).toBeVisible()
  await expect(viewer.getByRole('button', { name: '放大', exact: true })).toBeDisabled()
  await session.page.keyboard.press('Tab')
  await expect(viewer.getByRole('button', { name: '关闭资源查看' })).toBeFocused()
  await session.page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await session.page.keyboard.press('ControlOrMeta+End')
  await session.page.keyboard.type('仍可编辑')
  expect((await articleState()).source).toContain('仍可编辑')
  expect(await readFile(file, 'utf8')).not.toContain('仍可编辑')
})

test('查看器隔离原生保存和切换快捷键，原生窗口关闭仍保护未保存文章', async () => {
  const source = '# 关闭保护\n\n```mermaid\nflowchart LR\nA[开始] --> B[结束]\n```\n\n'
  const file = await openFixture(session, 'resource-close.md', source)
  await session.page.keyboard.press('ControlOrMeta+End')
  await session.page.keyboard.type('UNSAVED_VIEWER_DRAFT')
  const modified = (await articleState()).source
  await session.page.keyboard.press('ControlOrMeta+/')
  await setContextMenuChoice(session, 'view-resource')
  await session.page.locator('.md-mermaid svg').click({ button: 'right' })
  const viewer = session.page.getByTestId('resource-viewer')
  await expect(viewer).toBeVisible()
  await session.page.keyboard.press('ControlOrMeta+s')
  await session.page.keyboard.press('ControlOrMeta+/')
  expect((await articleState()).mode).toBe('hybrid')
  expect(await readFile(file, 'utf8')).toBe(source)
  await setMessageResponse(session, 2)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect(viewer).toBeVisible()
  expect((await articleState()).source).toBe(modified)
  await session.page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  expect((await articleState()).focused).toBe(true)
})
