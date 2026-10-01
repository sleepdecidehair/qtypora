import { test, expect } from '@playwright/test'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appendText, contextMenuActions, launchDesktop, openFixture, readCreatedBytes, readCreatedText, releaseContextMenu, setContextMenuChoice, setMessageResponse, setOpenDialog, setSaveDialog, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  if (!session) return
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors, 'No unhandled renderer errors').toEqual([])
})

async function openWorkspace(directory: string): Promise<void> {
  await setOpenDialog(session, [directory])
  await session.page.getByTestId('files-tab').click()
  await session.page.getByTestId('workspace-folder').click()
  await expect(session.page.getByTestId('workspace-folder')).toHaveText(path.basename(directory))
}

async function editorState() {
  return session.page.locator('.cm-content').evaluate(element => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    return { content: view.state.doc.toString(), selection: view.state.selection.toJSON(), focused: view.hasFocus }
  })
}

test('文件原生右键取消保持活动文档、未保存内容、选区和焦点', async () => {
  const original = '# 当前文章\n\n尚未保存。\n'
  await openFixture(session, 'active.md', original)
  await writeFile(path.join(session.root, 'target.md'), '# 另一篇文章\n')
  await openWorkspace(session.root)
  await appendText(session, '原来的草稿')
  await session.page.keyboard.press('Control+Home')
  await session.page.keyboard.press('Shift+ArrowRight')
  const before = await editorState()
  await setContextMenuChoice(session, null)
  await session.page.getByRole('treeitem', { name: 'target.md', exact: true }).click({ button: 'right' })
  await expect.poll(() => contextMenuActions(session)).toContain('file-duplicate')
  expect(await editorState()).toEqual(before)
  await expect(session.page).toHaveTitle(/active\.md/)
  expect(await readFile(path.join(session.root, 'active.md'), 'utf8')).toBe(original)
})

test('原生创建副本复制磁盘版本且保留原文章草稿，目录菜单不提供删除根目录', async () => {
  const original = '# 磁盘版本\n'
  await openFixture(session, 'duplicate.md', original)
  await openWorkspace(session.root)
  await appendText(session, '还未保存的编辑')
  const before = await editorState()
  await setContextMenuChoice(session, 'file-duplicate')
  await session.page.getByRole('treeitem', { name: 'duplicate.md', exact: true }).click({ button: 'right' })
  let copied = ''
  await expect.poll(async () => {
    copied = (await readdir(session.root)).find(name => name.endsWith('.md') && name !== 'duplicate.md') ?? ''
    return copied
  }).not.toBe('')
  expect(await readFile(path.join(session.root, copied), 'utf8')).toBe(original)
  expect(await editorState()).toEqual(before)
  await expect(session.page.locator('.open-document-row.is-current .dirty-dot')).toBeVisible()
  await setContextMenuChoice(session, null)
  await session.page.getByTestId('workspace-folder').click({ button: 'right' })
  await expect.poll(() => contextMenuActions(session)).toContain('file-refresh')
  expect(await contextMenuActions(session)).not.toEqual(expect.arrayContaining(['file-rename']))
  expect(await contextMenuActions(session)).not.toEqual(expect.arrayContaining(['file-trash']))
})

test('目录右键新窗口加载真实目录，新建文件在被点击的目录内创建', async () => {
  const folder = path.join(session.root, 'subfolder')
  await mkdir(folder)
  await writeFile(path.join(folder, 'nested.md'), '# 子目录\n')
  await openWorkspace(session.root)
  const row = session.page.getByRole('treeitem', { name: 'subfolder', exact: true })
  await setContextMenuChoice(session, 'file-new-file')
  await row.click({ button: 'right' })
  await session.page.getByLabel('文件或文件夹名称').fill('created.md')
  await session.page.getByRole('button', { name: '确定', exact: true }).click()
  await expect.poll(async () => (await readdir(folder)).includes('created.md')).toBe(true)
  await setContextMenuChoice(session, 'file-new-window')
  const second = session.app.waitForEvent('window')
  await row.click({ button: 'right' })
  const page = await second
  await expect(page.getByTestId('workspace-folder')).toHaveText('subfolder')
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap())
  expect(bootstrap.ok && bootstrap.data.workspace?.path).toBe(await realpath(folder))
  expect(bootstrap.ok && bootstrap.data.workspace?.entries.map(entry => entry.name)).toEqual(expect.arrayContaining(['nested.md', 'created.md']))
})

test('待决文件右键结果在目录切换后失效，不弹出错误目录的重命名', async () => {
  const first = path.join(session.root, 'first')
  const second = path.join(session.root, 'second')
  await mkdir(first)
  await mkdir(second)
  await writeFile(path.join(first, 'old.md'), '# 原目录\n')
  await writeFile(path.join(second, 'old.md'), '# 新目录\n')
  await openWorkspace(first)
  await setContextMenuChoice(session, null, true)
  await session.page.getByRole('treeitem', { name: 'old.md', exact: true }).click({ button: 'right' })
  await expect.poll(() => contextMenuActions(session)).toContain('file-rename')
  await openWorkspace(second)
  await releaseContextMenu(session, 'file-rename')
  await expect(session.page.getByRole('dialog', { name: '重命名', exact: true })).toHaveCount(0)
  expect(await readFile(path.join(first, 'old.md'), 'utf8')).toBe('# 原目录\n')
  expect(await readFile(path.join(second, 'old.md'), 'utf8')).toBe('# 新目录\n')
})

test('未命名文档没有磁盘右键菜单，正文原生右键取消不切模式不修改正文', async () => {
  await session.page.getByTestId('files-tab').click()
  await session.page.keyboard.press('Control+n')
  await setContextMenuChoice(session, null)
  await session.page.locator('.open-document-row.is-current').click({ button: 'right' })
  expect(await contextMenuActions(session)).toEqual([])
  await appendText(session, '正文右键测试')
  const before = await editorState()
  await setContextMenuChoice(session, null)
  await session.page.locator('.cm-line').filter({ hasText: '正文右键测试' }).click({ button: 'right' })
  await expect.poll(() => contextMenuActions(session)).toContain('paste')
  expect((await editorState()).content).toBe(before.content)
  await expect(session.page.locator('.cm-content')).toHaveAttribute('data-mode', 'source')
})

test('高宽超大图片与 Mermaid 都完整适应正文宽高，缩小窗口后仍保持完整比例', async () => {
  await writeFile(path.join(session.root, 'large.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800" viewBox="0 0 2400 1800"><rect x="2" y="2" width="2396" height="1796" fill="#e0e9ff" stroke="#235" stroke-width="4"/><text x="1200" y="900" text-anchor="middle" font-size="96">完整图片</text></svg>')
  const graph = Array.from({ length: 28 }, (_, index) => `N${index}[步骤 ${index}] --> N${index + 1}[步骤 ${index + 1}]`).join('\n')
  await openFixture(session, 'fit-resources.md', `# 完整资源\n\n![全尺寸图片](large.svg)\n\n\`\`\`mermaid\ngraph TB\n${graph}\n\`\`\`\n`)
  await session.page.keyboard.press('Control+/')
  const editor = session.page.locator('.cm-content')
  const image = editor.getByRole('img', { name: '全尺寸图片', exact: true })
  const graphSvg = editor.locator('.md-mermaid svg')
  const fits = async () => {
    const imageSize = await image.evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
    const limits = await session.page.locator('.cm-scroller').evaluate(element => ({ width: element.clientWidth - 64, height: element.clientHeight - 80 }))
    return imageSize.width <= limits.width + 1 && imageSize.height <= limits.height + 1 && Math.abs(imageSize.width / imageSize.height - 4 / 3) < 0.01
  }
  await expect.poll(fits).toBe(true)
  await graphSvg.scrollIntoViewIfNeeded()
  await expect(graphSvg).toBeVisible()
  await expect.poll(async () => graphSvg.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const scroller = element.closest('.cm-scroller')!
    return rect.width <= scroller.clientWidth - 63 && rect.height <= scroller.clientHeight - 79
  })).toBe(true)
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(980, 640))
  await image.scrollIntoViewIfNeeded()
  await expect.poll(fits).toBe(true)
  expect(await readFile(path.join(session.root, 'fit-resources.md'), 'utf8')).toContain('![全尺寸图片](large.svg)')
})

test('表格原生菜单精确插列与对齐且可撤销，最小行列不能误删整表', async () => {
  const content = '__保留前文__\n\n| First | Second |\n| --- | --- |\n| ONE | TWO |\n\n[保持引用][ref]\n\n[ref]: https://example.com\n'
  const file = await openFixture(session, 'context-table.md', content)
  await session.page.keyboard.press('Control+/')
  let cell = session.page.getByTestId('live-table').getByText('TWO', { exact: true })
  await setContextMenuChoice(session, 'table-align-center')
  await cell.click({ button: 'right' })
  await session.page.keyboard.press('Control+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(content.replace('| --- | --- |', '| --- | :---: |'))
  // Disk replacement precedes the IPC save reply; wait for the save lock to be released.
  await expect(session.page.getByTestId('save-document')).toBeEnabled()
  await session.page.keyboard.press('Control+z')
  await expect.poll(async () => (await editorState()).content).toBe(content)
  await session.page.keyboard.press('Control+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(content)
  await setContextMenuChoice(session, 'table-column-before')
  await cell.click({ button: 'right' })
  await expect(session.page.getByTestId('live-table').locator('th')).toHaveCount(3)
  await session.page.keyboard.press('Control+z')
  await expect(session.page.getByTestId('live-table').locator('th')).toHaveCount(2)
  await setContextMenuChoice(session, null)
  await cell.click({ button: 'right' })
  await expect.poll(() => contextMenuActions(session)).toContain('table-delete')
  expect(await contextMenuActions(session)).not.toContain('table-row-delete')
  await setContextMenuChoice(session, 'table-column-delete')
  await cell.click({ button: 'right' })
  await expect(session.page.getByTestId('live-table').locator('th')).toHaveCount(1)
  cell = session.page.getByTestId('live-table').getByText('ONE', { exact: true })
  await setContextMenuChoice(session, null)
  await cell.click({ button: 'right' })
  expect(await contextMenuActions(session)).not.toContain('table-column-delete')
  await session.page.keyboard.press('Control+z')
  await session.page.keyboard.press('Control+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(content)
})

test('实时预览原生复制同时给文本与HTML，源码剪切可撤销且纯文本粘贴保留Markdown', async () => {
  const content = '复制 **粗体** 的正文\n'
  const file = await openFixture(session, 'context-clipboard.md', content)
  await session.page.keyboard.press('Control+/')
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.press('Control+a')
  await setContextMenuChoice(session, 'copy')
  await session.page.locator('.cm-line').filter({ hasText: '复制' }).click({ button: 'right' })
  await expect.poll(async () => session.app.evaluate(async ({ clipboard }) => {
    const entries = await clipboard.read()
    const html = entries.find(item => item.types.includes('text/html'))
    return html ? (await html.getType('text/html')).text() : ''
  })).toContain('<strong>粗体</strong>')
  await session.page.keyboard.press('Control+/')
  await session.page.keyboard.press('Control+a')
  await setContextMenuChoice(session, 'cut')
  await session.page.locator('.cm-line').filter({ hasText: '复制' }).click({ button: 'right' })
  await expect.poll(async () => (await editorState()).content).toBe('')
  await session.page.keyboard.press('Control+z')
  await expect.poll(async () => (await editorState()).content).toBe(content)
  await session.app.evaluate(async ({ clipboard }) => clipboard.writeText('[粘贴文本](https://example.com)'))
  expect(await session.app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('[粘贴文本](https://example.com)')
  await session.page.keyboard.press('Control+End')
  await setContextMenuChoice(session, 'paste-plain')
  await session.page.locator('.cm-line').last().click({ button: 'right' })
  await expect.poll(() => contextMenuActions(session)).toContain('paste-plain')
  await expect.poll(async () => (await editorState()).content).toBe(content + '[粘贴文本](https://example.com)')
  await session.page.keyboard.press('Control+s')
  await expect.poll(() => readFile(file, 'utf8')).toBe(content + '[粘贴文本](https://example.com)')
})

test('代码、链接与公式原生菜单复制对应对象内容，查看数学资源可关闭', async () => {
  const code = 'const value = 1;\nconsole.log(value);'
  await openFixture(session, 'context-objects.md', `# 对象\n\n\`\`\`js\n${code}\n\`\`\`\n\n[链接](https://example.com/context)\n\n$$\nx^2 + y^2\n$$\n`)
  await setContextMenuChoice(session, 'copy-code')
  await session.page.locator('.cm-line').filter({ hasText: 'console.log(value)' }).click({ button: 'right' })
  await expect.poll(() => session.app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe(code)
  await session.page.keyboard.press('Control+/')
  await setContextMenuChoice(session, 'copy-link')
  await session.page.locator('.cm-live-link').click({ button: 'right' })
  await expect.poll(() => session.app.evaluate(async ({ clipboard }) => clipboard.readText())).toBe('https://example.com/context')
  await setContextMenuChoice(session, 'copy-math')
  await session.page.locator('.md-math').click({ button: 'right' })
  await expect.poll(() => session.app.evaluate(async ({ clipboard }) => clipboard.readText())).toContain('x^2 + y^2')
  await setContextMenuChoice(session, 'copy-mathml')
  await session.page.locator('.md-math').click({ button: 'right' })
  await expect.poll(() => session.app.evaluate(async ({ clipboard }) => clipboard.readText())).toContain('<math')
  await setContextMenuChoice(session, 'view-resource')
  await session.page.locator('.md-math').click({ button: 'right' })
  await expect(session.page.getByTestId('resource-viewer')).toBeVisible()
  await session.page.keyboard.press('Escape')
  await expect(session.page.getByTestId('resource-viewer')).toHaveCount(0)
})

test('图表原生保存SVG、PNG及JPEG生成可解码资源且保持源文档', async () => {
  const content = '# 图表资源\n\n```mermaid\ngraph LR\nA[开始] --> B[结束]\nstyle A fill:#fff4cc,stroke:#ae8a22;\n```\n'
  const file = await openFixture(session, 'context-diagram.md', content)
  await session.page.keyboard.press('Control+/')
  const diagram = session.page.locator('.md-mermaid svg')
  await expect(diagram).toBeVisible()
  for (const format of ['svg', 'png', 'jpeg'] as const) {
    const destination = path.join(session.root, `saved-resource.${format}`)
    await setSaveDialog(session, destination)
    await setContextMenuChoice(session, `resource-save-${format}`)
    await diagram.click({ button: 'right' })
    await expect.poll(async () => (await readCreatedBytes(destination)).length).toBeGreaterThan(100)
    if (format === 'svg') {
      const svg = await readFile(destination, 'utf8')
      expect(svg).toContain('viewBox=')
      expect(svg).toContain('开始')
      expect(svg).toMatch(/(?:#fff4cc|rgb\(255,\s*244,\s*204\))/)
      expect(svg).not.toContain('foreignObject')
    } else {
      const bytes = await readFile(destination)
      const dimensions = await session.app.evaluate(({ nativeImage }, base64) => nativeImage.createFromBuffer(Buffer.from(base64, 'base64')).getSize(), bytes.toString('base64'))
      expect(dimensions.width).toBeGreaterThan(10)
      expect(dimensions.height).toBeGreaterThan(10)
    }
  }
  expect(await readFile(file, 'utf8')).toBe(content)
  expect((await editorState()).content).toBe(content)
})

const smallSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><rect width="160" height="90" fill="#9dc"/></svg>'

test('本地图片原生复制、移动与取消删除实际落盘并精确更新当前引用', async () => {
  const original = path.join(session.root, 'original.svg')
  await writeFile(original, smallSvg)
  const content = '__前文不变__\n\n![图片操作](original.svg)\n\n[尾部引用][tail]\n\n[tail]: https://example.com\n'
  const document = await openFixture(session, 'context-image.md', content)
  await session.page.keyboard.press('Control+/')
  const image = session.page.getByRole('img', { name: '图片操作', exact: true })
  const copied = path.join(session.root, 'copied.svg')
  await setSaveDialog(session, copied)
  await setContextMenuChoice(session, 'image-copy')
  await image.click({ button: 'right' })
  await expect.poll(() => readCreatedText(copied)).toBe(smallSvg)
  await expect.poll(async () => (await editorState()).content).toBe(content.replace('(original.svg)', '(copied.svg)'))
  expect(await readFile(original, 'utf8')).toBe(smallSvg)
  const moved = path.join(session.root, 'renamed.svg')
  await setSaveDialog(session, moved)
  await setMessageResponse(session, 0)
  await setContextMenuChoice(session, 'image-move')
  await image.click({ button: 'right' })
  await expect.poll(() => readCreatedText(moved)).toBe(smallSvg)
  await expect.poll(async () => (await readdir(session.root)).includes('copied.svg')).toBe(false)
  await expect.poll(async () => (await editorState()).content).toBe(content.replace('(original.svg)', '(renamed.svg)'))
  await setMessageResponse(session, 1)
  await setContextMenuChoice(session, 'image-delete')
  await image.click({ button: 'right' })
  await expect.poll(() => contextMenuActions(session)).toContain('image-delete')
  expect(await readFile(moved, 'utf8')).toBe(smallSvg)
  expect((await editorState()).content).toContain('(renamed.svg)')
  await session.page.keyboard.press('Control+s')
  await expect.poll(() => readFile(document, 'utf8')).toBe(content.replace('(original.svg)', '(renamed.svg)'))
})

test('图片移动对话框迟到时正文的新输入阻止磁盘移动，菜单迟到也不改新正文', async () => {
  await writeFile(path.join(session.root, 'original.svg'), smallSvg)
  await openFixture(session, 'image-stale.md', '![迟到图片](original.svg)\n\n原来的正文\n')
  await session.page.keyboard.press('Control+/')
  await session.app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () => new Promise(resolve => Reflect.set(globalThis, 'qtyporaDelayedImageDestination', resolve))
  })
  await setMessageResponse(session, 0)
  await setContextMenuChoice(session, 'image-move')
  await session.page.getByRole('img', { name: '迟到图片', exact: true }).click({ button: 'right' })
  await expect.poll(() => session.app.evaluate(() => typeof Reflect.get(globalThis, 'qtyporaDelayedImageDestination'))).toBe('function')
  await session.page.keyboard.press('Control+/')
  await appendText(session, '对话框之后的新内容')
  await expect.poll(async () => session.page.evaluate(async () => {
    const data = await window.desktop.bootstrap()
    return data.ok && data.data.documents.some(document => document.content.includes('对话框之后的新内容'))
  })).toBe(true)
  await session.app.evaluate((_electron, destination) => {
    const resolve = Reflect.get(globalThis, 'qtyporaDelayedImageDestination') as (value: { canceled: boolean; filePath: string }) => void
    resolve({ canceled: false, filePath: destination })
  }, path.join(session.root, 'stale-move.svg'))
  await expect(session.page.getByText('文档在图片操作期间发生变化', { exact: false })).toBeVisible()
  expect((await readdir(session.root)).includes('stale-move.svg')).toBe(false)
  expect(await readFile(path.join(session.root, 'original.svg'), 'utf8')).toBe(smallSvg)
  await setContextMenuChoice(session, null, true)
  await session.page.locator('.cm-line').filter({ hasText: '原来的正文' }).click({ button: 'right' })
  await expect.poll(() => contextMenuActions(session)).toContain('bold')
  await appendText(session, '菜单之后的新内容')
  const before = (await editorState()).content
  await releaseContextMenu(session, 'bold')
  await expect(session.page.getByText('文档或目标内容已变化', { exact: false })).toBeVisible()
  expect((await editorState()).content).toBe(before)
})

test('移除图片引用保留原文件，明确删除图片才移除原文件与引用', async () => {
  const original = path.join(session.root, 'delete-test.svg')
  await writeFile(original, smallSvg)
  const content = '前段保持\n\n![删除图片](delete-test.svg)\n\n尾段保持\n'
  const article = await openFixture(session, 'delete-reference.md', content)
  await session.page.keyboard.press('Control+/')
  const image = session.page.getByRole('img', { name: '删除图片', exact: true })
  await setContextMenuChoice(session, 'image-remove')
  await image.click({ button: 'right' })
  await expect(image).toHaveCount(0)
  expect(await readFile(original, 'utf8')).toBe(smallSvg)
  await session.page.keyboard.press('Control+z')
  await expect(image).toBeVisible()
  await setMessageResponse(session, 0)
  await setContextMenuChoice(session, 'image-delete')
  await image.click({ button: 'right' })
  await expect(image).toHaveCount(0)
  expect((await readdir(session.root)).includes('delete-test.svg')).toBe(false)
  await session.page.keyboard.press('Control+s')
  await expect.poll(() => readFile(article, 'utf8')).toBe(content.replace('![删除图片](delete-test.svg)', ''))
})
