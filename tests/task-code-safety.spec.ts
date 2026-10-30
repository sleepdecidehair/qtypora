import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

test('缩进代码中的任务标记不生成复选框，真实任务仍可切换并撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = '前文\n\n    - [ ] code\n\n- [ ] real'
    const file = await openFixture(session, 'task-code.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    const checkbox = editor.getByRole('checkbox')
    await expect(checkbox).toHaveCount(1)
    await checkbox.click()
    await expect.poll(source).toBe('前文\n\n    - [ ] code\n\n- [x] real')
    await editor.click()
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})

for (const [name, original] of [['unclosed', '```\n- [ ] literal'], ['quoted', '> ```\n> - [ ] literal\n> ```']] as const) {
  test(`${name} 代码围栏中的任务标记保持原文且不可点击`, async () => {
    const session = await launchDesktop()
    try {
      const file = await openFixture(session, `${name}-task-code.md`, original)
      await session.page.keyboard.press('ControlOrMeta+/')
      const editor = session.page.locator('.cm-content')
      await expect(editor.getByRole('checkbox')).toHaveCount(0)
      expect(await editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())).toBe(original)
      expect(await readFile(file, 'utf8')).toBe(original)
      expect(session.errors).toEqual([])
    } finally { await stopDesktop(session) }
  })
}

test('长文档后台解析完成后真实任务框可见并可撤销', async () => {
  const session = await launchDesktop()
  try {
    const original = 'ordinary paragraph\n\n'.repeat(1000) + '- [ ] task'
    const file = await openFixture(session, 'late-task.md', original)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const source = () => editor.evaluate(element => (Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView).state.doc.toString())
    await expect(editor).toHaveAttribute('data-mode', 'hybrid')
    await editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      const scrollIntoView = Reflect.get(view.constructor, 'scrollIntoView') as typeof import('@codemirror/view').EditorView.scrollIntoView
      view.dispatch({ effects: scrollIntoView(view.state.doc.length, { y: 'end' }) })
    })
    await expect.poll(() => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      const task = view.state.doc.length - '- [ ] task'.length
      return view.visibleRanges.some(range => range.from <= task && range.to >= task + '- [ ] task'.length)
    })).toBe(true)
    const checkbox = editor.getByRole('checkbox')
    await expect(checkbox).toHaveCount(1)
    await checkbox.click()
    await expect.poll(source).toBe(original.replace('- [ ] task', '- [x] task'))
    await editor.click()
    await session.page.keyboard.press('ControlOrMeta+z')
    await expect.poll(source).toBe(original)
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(session.errors).toEqual([])
  } finally { await stopDesktop(session) }
})
