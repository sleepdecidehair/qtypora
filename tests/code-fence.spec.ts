import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, redoKey, stopDesktop, type DesktopSession } from './desktop-helpers'

let session: DesktopSession
test.beforeEach(async () => { session = await launchDesktop() })
test.afterEach(async () => {
  if (!session) return
  const errors = [...session.errors]
  await stopDesktop(session)
  expect(errors).toEqual([])
})

async function editorState(): Promise<{ text: string; anchor: number; head: number; selected: string }> {
  return session.page.locator('.cm-content').evaluate((element) => {
    const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
    const selection = view.state.selection.main
    return { text: view.state.doc.toString(), anchor: selection.anchor, head: selection.head, selected: view.state.doc.sliceString(selection.from, selection.to) }
  })
}

async function highlightedCodeTokens(): Promise<number> {
  return session.page.locator('.cm-content').evaluate(element => {
    const base = getComputedStyle(element).color
    return [...element.querySelectorAll('.cm-live-code-body span[class]')].filter(token => getComputedStyle(token).color !== base).length
  })
}

for (const { language, body } of [
  { language: 'Python', body: 'def greet(name):\n    return "Hello, " + name' },
  { language: 'JSON', body: '{"name":"QTypora","enabled":true,"count":3}' },
  { language: 'HTML', body: '<section class="example">Hello</section>' },
  { language: 'mArKdOwN', body: '# Example\n\n**bold** and [link](https://example.com)' },
  { language: 'cpp', body: 'int main() { return 42; }' },
  { language: 'TypeScript', body: 'const answer: number = 42;' },
  { language: 'SQL', body: 'SELECT name FROM users WHERE id = 1;' },
  { language: 'YAML', body: 'enabled: true\ncount: 42' },
  { language: 'bash', body: 'echo "hello"' },
  { language: 'Rust', body: 'fn main() { println!("hello"); }' },
]) {
  test(`右下角输入 ${language} 后代码正文应用对应语法高亮并保存语言`, async () => {
    const destination = await openFixture(session, 'code-highlight.md', '```\n' + body + '\n```')
    await session.page.keyboard.press('ControlOrMeta+/')
    const languageInput = session.page.getByRole('combobox', { name: '代码块语言' })
    await expect.poll(highlightedCodeTokens).toBe(0)
    await languageInput.fill(language)
    await languageInput.press('Enter')
    await expect(languageInput).toHaveValue(language)
    await expect.poll(highlightedCodeTokens).toBeGreaterThan(0)
    expect((await editorState()).head).toBe(4 + language.length)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(destination, 'utf8')).toBe('```' + language + '\n' + body + '\n```')
  })
}

test('切换语言只重绘代码高亮，清空或未知语言恢复纯文本', async () => {
  const body = 'def greet(name):\n    return "Hello, " + name'
  await openFixture(session, 'code-highlight-switch.md', '```Python\n' + body + '\n```')
  await session.page.keyboard.press('ControlOrMeta+/')
  const language = session.page.getByRole('combobox', { name: '代码块语言' })
  await expect.poll(highlightedCodeTokens).toBeGreaterThan(0)
  await language.fill('JSON')
  await language.press('Escape')
  await language.press('Escape')
  await expect(language).toHaveValue('Python')
  expect((await editorState()).text).toBe('```Python\n' + body + '\n```')
  await language.fill('qtypora_unknown_language')
  await language.press('Enter')
  await expect.poll(highlightedCodeTokens).toBe(0)
  await language.fill('Python')
  await language.press('Enter')
  await expect.poll(highlightedCodeTokens).toBeGreaterThan(0)
  await language.fill('')
  await language.press('Tab')
  await expect.poll(highlightedCodeTokens).toBe(0)
  expect((await editorState()).text).toBe('```\n' + body + '\n```')
})

test('语言候选按前缀和别名搜索，支持键盘及鼠标选择并独立撤销', async () => {
  const original = '```\nconst greeting = "hello";\n```\n\n```\necho "hello"\n```'
  await openFixture(session, 'code-suggestions.md', original)
  await session.page.keyboard.press('ControlOrMeta+/')
  const languages = session.page.getByRole('combobox', { name: '代码块语言' })
  const suggestions = session.page.getByRole('listbox', { name: '代码语言建议' })
  await languages.first().click()
  await expect(suggestions.getByRole('option')).toHaveCount(143)
  await languages.first().fill('jav')
  await expect(suggestions.getByRole('option')).toHaveText(['Java', 'JavaScript'])
  await languages.first().press('ArrowDown')
  await languages.first().press('ArrowDown')
  await expect(suggestions.getByRole('option', { name: 'JavaScript', exact: true })).toHaveAttribute('aria-selected', 'true')
  await languages.first().press('Enter')
  await expect(languages.first()).toHaveValue('javascript')
  await expect.poll(highlightedCodeTokens).toBeGreaterThan(0)
  await languages.nth(1).fill('BASH')
  await expect(suggestions.getByRole('option')).toHaveText('Shell')
  await suggestions.getByRole('option', { name: 'Shell', exact: true }).click()
  await expect(languages.nth(1)).toHaveValue('shell')
  const expected = original.replace('```\nconst', '```javascript\nconst').replace('```\necho', '```shell\necho')
  expect((await editorState()).text).toBe(expected)
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect(languages.nth(1)).toHaveValue('')
  await expect(languages.first()).toHaveValue('javascript')
  await session.page.keyboard.press(redoKey)
  await expect(languages.nth(1)).toHaveValue('shell')
  expect((await editorState()).text).toBe(expected)
  await languages.first().fill('py')
  await expect(suggestions.getByRole('option')).toHaveText('Python')
  expect(await suggestions.evaluate(element => element.scrollHeight - element.clientHeight)).toBe(0)
  await session.page.screenshot({ path: '.debug/code-language-suggestions.png' })
  await languages.first().press('Escape')
  await expect(session.page.getByRole('listbox', { name: '代码语言建议' })).toHaveCount(0)
  expect((await editorState()).text).toBe(expected)
  await languages.first().press('Escape')
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(session.page.locator('.cm-code-language-suggestions')).toHaveCount(0)
})

test('创建时在反引号后写 Python 或空格加 Python，Enter 直接应用语言', async () => {
  await openFixture(session, 'code-language-creation.md', '')
  await session.page.keyboard.press('ControlOrMeta+/')
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.type('```Python')
  await session.page.keyboard.press('Enter')
  const languages = session.page.getByRole('combobox', { name: '代码块语言' })
  await expect(languages.first()).toHaveValue('Python')
  await session.page.keyboard.insertText('print("hello")')
  await expect.poll(highlightedCodeTokens).toBeGreaterThan(0)
  await session.page.keyboard.press('ControlOrMeta+Enter')
  await session.page.keyboard.type('``` python')
  await session.page.keyboard.press('Enter')
  await expect(languages.nth(1)).toHaveValue('python')
  await session.page.keyboard.insertText('return 42')
  expect((await editorState()).text).toBe('```Python\nprint("hello")\n```\n\n``` python\nreturn 42\n```')
})

test('三个反引号加 Enter 创建可编辑代码块，撤销和源码切换保留原文光标', async () => {
  const destination = await openFixture(session, 'code-fence.md', '')
  await session.page.keyboard.press('ControlOrMeta+/')
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.type('```')
  await expect(editor.locator('.cm-line')).toHaveText('```')
  await session.page.keyboard.press('Enter')
  await expect(editor.locator('.cm-live-code-body')).toHaveCount(1)
  await expect(editor).not.toContainText('```')
  await expect(session.page.getByRole('combobox', { name: '代码块语言' })).toBeVisible()
  expect(await editorState()).toMatchObject({ text: '```\n\n```', head: 4 })
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect(editor.locator('.cm-line')).toHaveText('```')
  expect(await editorState()).toMatchObject({ text: '```', head: 3 })
  await session.page.keyboard.press(redoKey)
  await expect(editor.locator('.cm-live-code-body')).toHaveCount(1)
  await session.page.keyboard.insertText('const answer = 42;')
  await session.page.keyboard.press('Enter')
  await session.page.keyboard.insertText('- [ ] **literal**')
  await expect(editor.locator('.cm-live-code-body')).toHaveCount(2)
  await expect.poll(async () => editor.evaluate(element => {
    const last = element.querySelector('.cm-live-code-last')!.getBoundingClientRect()
    const footer = element.querySelector('.cm-live-code-footer')!.getBoundingClientRect()
    return Math.abs(footer.top - last.bottom)
  })).toBeLessThan(1)
  await expect(editor.locator('input[type=checkbox]')).toHaveCount(0)
  await expect(editor.locator('.cm-live-strong')).toHaveCount(0)
  const before = await editorState()
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'source')
  await expect(editor).toContainText('```')
  await session.page.keyboard.press('ControlOrMeta+/')
  await expect(editor).toHaveAttribute('data-mode', 'hybrid')
  expect(await editorState()).toEqual(before)
  await session.page.keyboard.press('ControlOrMeta+a')
  expect((await editorState()).selected).toBe('const answer = 42;\n- [ ] **literal**')
  await session.page.keyboard.press('ArrowRight')
  await session.page.keyboard.press('ControlOrMeta+Enter')
  await session.page.keyboard.insertText('后续正文')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe('```\nconst answer = 42;\n- [ ] **literal**\n```\n\n后续正文')
  await session.page.screenshot({ path: '.debug/code-fence-created.png' })
})

test('代码块保留显式语言，修改语言后正文仍可直接输入', async () => {
  const destination = await openFixture(session, 'code-language.md', '')
  await session.page.keyboard.press('ControlOrMeta+/')
  await session.page.locator('.cm-content').click()
  await session.page.keyboard.type('```js')
  await session.page.keyboard.press('Enter')
  const language = session.page.getByRole('combobox', { name: '代码块语言' })
  await expect(language).toHaveValue('js')
  await language.fill('python')
  await language.press('Enter')
  await expect(language).toHaveValue('python')
  await session.page.keyboard.insertText('print("hello")')
  await expect(session.page.locator('.cm-live-code-body')).toHaveText('print("hello")')
  await session.page.keyboard.press('ControlOrMeta+s')
  await expect.poll(() => readFile(destination, 'utf8')).toBe('```python\nprint("hello")\n```')
  await session.page.keyboard.press('ControlOrMeta+z')
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect(language).toHaveValue('js')
  expect((await editorState()).text).toBe('```js\n\n```')
})

test('源码模式 Enter 保留普通编辑，空代码块可退回段落并撤销', async () => {
  await openFixture(session, 'code-source.md', '')
  const editor = session.page.locator('.cm-content')
  await editor.click()
  await session.page.keyboard.type('```')
  await session.page.keyboard.press('Enter')
  expect((await editorState()).text).toBe('```\n')
  await session.page.keyboard.press('ControlOrMeta+z')
  await session.page.keyboard.press('ControlOrMeta+/')
  await session.page.keyboard.press('Enter')
  await expect(editor.locator('.cm-live-code-body')).toHaveCount(1)
  await session.page.keyboard.press('Backspace')
  expect((await editorState()).text).toBe('')
  await expect(editor.locator('.cm-live-code-body')).toHaveCount(0)
  await session.page.keyboard.press('ControlOrMeta+z')
  await expect(editor.locator('.cm-live-code-body')).toHaveCount(1)
  expect((await editorState()).text).toBe('```\n\n```')
})
