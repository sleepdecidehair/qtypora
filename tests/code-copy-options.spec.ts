import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, setContextMenuChoice, stopDesktop } from './desktop-helpers'

async function clipboardPayload(session: Awaited<ReturnType<typeof launchDesktop>>) {
  return session.app.evaluate(async ({ clipboard }) => {
    const items = await clipboard.read()
    const get = async (type: 'text/html' | 'text/rtf') => {
      const item = items.find(candidate => candidate.types.includes(type))
      return item ? (await item.getType(type)).text() : ''
    }
    return { text: await clipboard.readText(), html: await get('text/html'), rtf: await get('text/rtf') }
  })
}

test('单个代码块设置不更改原文，模式切换与语言切换保持独立设置', async () => {
  const session = await launchDesktop()
  try {
    const original = 'before\n\n```js\nfirst()\n```\n\n```js\nsecond()\n```\n'
    const filename = await openFixture(session, 'code-block-options.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const codeLines = session.page.locator('.cm-live-code-body')
    await expect(codeLines).toHaveCount(2)
    const firstBox = await codeLines.first().boundingBox()
    await session.page.getByText('代码块显示', { exact: true }).first().click()
    await session.page.getByLabel('当前代码块行号').first().selectOption('on')
    await expect(codeLines.first()).toHaveClass(/cm-live-code-numbered/)
    await expect(codeLines.last()).not.toHaveClass(/cm-live-code-numbered/)
    await session.page.getByLabel('当前代码块折行').first().selectOption('off')
    await expect(codeLines.first()).toHaveClass(/cm-live-code-nowrap/)
    await expect(codeLines.last()).not.toHaveClass(/cm-live-code-nowrap/)
    expect((await codeLines.first().boundingBox())!.y).toBeCloseTo(firstBox!.y, 0)
    const readSource = () => session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString() as string)
    expect(await readSource()).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.keyboard.press('ControlOrMeta+/')
    await expect(codeLines.first()).toHaveClass(/cm-live-code-numbered/)
    await expect(codeLines.first()).toHaveClass(/cm-live-code-nowrap/)
    const before = await session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.selection.main.head as number)
    const result = await session.page.evaluate(() => window.desktop.patchPreferences({ locale: 'en-US' }))
    expect(result.ok).toBe(true)
    await expect(session.page.getByText('Code block display', { exact: true }).first()).toBeVisible()
    expect(await readSource()).toBe(original)
    expect(await session.page.locator('.cm-content').evaluate(element => Reflect.get(element, 'cmTile').root.view.state.selection.main.head as number)).toBe(before)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(filename, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('默认复制同时提供文本、HTML和安全 RTF，无主题复制及 Markdown 原文快捷键保留原文', async () => {
  const session = await launchDesktop()
  try {
    const original = '# Heading\n\n中文 **粗体** and *italic*\n'
    const filename = await openFixture(session, 'copy-formats.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    await session.page.locator('.cm-content').click()
    await session.page.keyboard.press('ControlOrMeta+a')
    await session.page.keyboard.press('ControlOrMeta+c')
    await expect.poll(async () => (await clipboardPayload(session)).rtf).toContain('\\rtf1')
    let clip = await clipboardPayload(session)
    expect(clip.text).toBe(original)
    expect(clip.html).toContain('<strong>粗体</strong>')
    expect(clip.html).toContain('style=')
    expect(clip.rtf).toContain('\\b ')
    expect(clip.rtf).toContain('\\u31895?')
    await setContextMenuChoice(session, 'copy-without-theme')
    await session.page.locator('.cm-line').filter({ hasText: '中文' }).click({ button: 'right' })
    await expect.poll(async () => (await clipboardPayload(session)).html).not.toContain('style=')
    clip = await clipboardPayload(session)
    expect(clip.rtf).toContain('\\rtf1')
    expect(clip.text).toBe(original)
    expect((await session.page.evaluate(() => window.desktop.patchPreferences({ markdown: { copyPlainMarkdown: false } }))).ok).toBe(true)
    await session.page.keyboard.press('ControlOrMeta+c')
    await expect.poll(async () => (await clipboardPayload(session)).text).toContain('粗体')
    expect((await clipboardPayload(session)).text).not.toContain('**')
    await session.page.keyboard.press('ControlOrMeta+Shift+c')
    await expect.poll(async () => (await clipboardPayload(session)).text).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(filename, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('代码块 Shift+Tab 自动缩进通过源码事务完成且可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = 'before\n\n```javascript\nfunction f() {\nreturn 1\n}\n```\n\nafter\n'
    const filename = await openFixture(session, 'shift-tab-auto-indent.md', original)
    expect((await session.page.evaluate(() => window.desktop.patchPreferences({ markdown: { codeShiftTabAutoIndent: true } }))).ok).toBe(true)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await expect(editor.locator('.cm-live-code-body span[class]').first()).toBeVisible()
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      const start = view.state.doc.toString().indexOf('return 1')
      view.dispatch({ selection: { anchor: start, head: start + 8 } })
      view.focus()
    })
    await session.page.keyboard.press('Shift+Tab')
    const readSource = () => editor.evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString() as string)
    await expect.poll(readSource).toBe(original.replace('return 1', '  return 1'))
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(readSource).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(filename, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

test('编辑器语言切换翻译表格与任务控件，不翻译或修改文档内容', async () => {
  const session = await launchDesktop()
  try {
    const original = '- [ ] 用户原文\n\n| 标题 | 列二 |\n| --- | --- |\n| 第一 | 第二 |\n'
    const filename = await openFixture(session, 'editor-locale.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await expect(editor.getByRole('checkbox', { name: '标为完成' })).toBeVisible()
    const head = await editor.evaluate(element => Reflect.get(element, 'cmTile').root.view.state.selection.main.head as number)
    expect((await session.page.evaluate(() => window.desktop.patchPreferences({ locale: 'en-US' }))).ok).toBe(true)
    await expect(editor.getByRole('checkbox', { name: 'Mark as complete' })).toBeVisible()
    await expect(editor.getByRole('cell', { name: 'Table row 2 column 2' })).toBeVisible()
    await editor.getByText('Table tools', { exact: true }).click()
    await expect(editor.getByRole('button', { name: 'Resize', exact: true })).toBeVisible()
    expect(await editor.evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString())).toBe(original)
    expect(await editor.evaluate(element => Reflect.get(element, 'cmTile').root.view.state.selection.main.head as number)).toBe(head)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(filename, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})


test('语言切换本地化 YAML 与 Alert 提示，保留用户内容、选区和原文', async () => {
  const session = await launchDesktop()
  try {
    const original = '---\ntitle: 用户原文\nbroken: [x\n---\n\n> [!WARNING]\n> 用户原文\n\nend\n'
    const filename = await openFixture(session, 'editor-alert-locale.md', original)
    expect((await session.page.evaluate(() => window.desktop.patchPreferences({ markdown: { alerts: true } }))).ok).toBe(true)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await expect(editor.locator('.md-front-matter-label')).toHaveText('YAML 前置信息')
    await expect(editor.locator('.md-alert-title')).toHaveText('警告')
    const head = await editor.evaluate(element => Reflect.get(element, 'cmTile').root.view.state.selection.main.head as number)
    expect((await session.page.evaluate(() => window.desktop.patchPreferences({ locale: 'en-US' }))).ok).toBe(true)
    await expect(editor.locator('.md-front-matter-label')).toHaveText('YAML front matter')
    await expect(editor.locator('.md-front-matter-error')).toHaveText('Invalid YAML syntax; the source has been preserved.')
    await expect(editor.locator('.md-alert-title')).toHaveText('Warning')
    await expect(editor.locator('.md-alert')).toContainText('用户原文')
    expect(await editor.evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString())).toBe(original)
    expect(await editor.evaluate(element => Reflect.get(element, 'cmTile').root.view.state.selection.main.head as number)).toBe(head)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(filename, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})


test('混合模式替换等长围栏后仍可修改代码语言并撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '```js\nbody\n```\n\nafter\n'
    const filename = await openFixture(session, 'code-fence-replacement.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const language = editor.getByLabel('代码块语言')
    await expect(language).toHaveValue('js')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      const end = view.state.doc.toString().indexOf('```', 3)
      view.dispatch({ changes: [{ from: 0, to: 3, insert: '~~~' }, { from: end, to: end + 3, insert: '~~~' }], userEvent: 'input.replace' })
    })
    await language.fill('python')
    await language.press('Enter')
    const readSource = () => editor.evaluate(element => Reflect.get(element, 'cmTile').root.view.state.doc.toString() as string)
    await expect.poll(readSource).toBe('~~~python\nbody\n~~~\n\nafter\n')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(readSource).toBe('~~~js\nbody\n~~~\n\nafter\n')
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(readSource).toBe(original)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(filename, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
