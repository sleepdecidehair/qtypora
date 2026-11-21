import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchDesktop, openFixture, setContextMenuChoice, stopDesktop } from './desktop-helpers'

test('预览模式跨标题和正文拖选不填充段落间空白，编辑和撤销保留原文', async () => {
  const session = await launchDesktop()
  try {
    const source = '前文\n\n## 权限由宿主配置决定\n\nMCP server 可以提供 readOnlyHint 或 destructiveHint。\n\n结尾'
    const destination = await openFixture(session, 'preview-selection.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    await expect(editor).toHaveAttribute('data-mode', 'hybrid')
    const heading = source.indexOf('权限'), paragraph = source.indexOf('MCP server')
    const pointAt = (position: number) => editor.evaluate((element, offset) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      const rect = view.coordsAtPos(offset)
      if (!rect) throw new Error(`Missing coordinates for ${offset}`)
      return { x: rect.left, y: (rect.top + rect.bottom) / 2, top: rect.top, bottom: rect.bottom }
    }, position)
    const start = await pointAt(heading), end = await pointAt(paragraph + 10)
    for (const [from, to] of [[start, end], [end, start]]) {
      await session.page.mouse.move(from.x, from.y)
      await session.page.mouse.down()
      await expect(editor.locator('.cm-live-heading-2')).toHaveText('权限由宿主配置决定')
      await session.page.mouse.move(to.x, to.y, { steps: 12 })
      await session.page.mouse.up()
      await expect.poll(() => editor.evaluate(element => {
        const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
        return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
      })).toBe(source.slice(heading, paragraph + 10))
      await expect.poll(() => editor.evaluate((element, points) => {
        const markers = [...element.closest('.cm-scroller')!.querySelectorAll('.cm-preview-selectionLayer .cm-selectionBackground')]
        const covered = (x: number, y: number) => markers.some(marker => {
          const rect = marker.getBoundingClientRect()
          return rect.left <= x && rect.right >= x && rect.top <= y && rect.bottom >= y
        })
        return {
          heading: covered(points.start.x + 5, points.start.y),
          paragraph: covered(points.end.x - 5, points.end.y),
          gap: covered(points.start.x + 20, (points.start.bottom + points.end.top) / 2),
        }
      }, { start, end })).toEqual({ heading: true, paragraph: true, gap: false })
    }
    await session.page.keyboard.press('ControlOrMeta+Shift+c')
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source.slice(heading, paragraph + 10))
    await session.page.keyboard.insertText('替换')
    await session.page.keyboard.press('ControlOrMeta+z')
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(destination, 'utf8')).toBe(source)
    expect(session.errors).toEqual([])
  } finally {
    await stopDesktop(session)
  }
})

test('内联 HTML 锚点文字可拖选、复制、粘贴、编辑和跳转', async () => {
  const session = await launchDesktop()
  try {
    const source = 'Start\n\n[Markdown](#section "Title") · <a href="#section">HTML label</a> · End\n\n<a id="section"></a>\n\n### Destination\n\nPaste here: '
    const destination = await openFixture(session, 'inline-anchor.md', source)
    await session.page.keyboard.press('ControlOrMeta+/')
    const editor = session.page.locator('.cm-content')
    const links = editor.locator('.cm-live-link')
    const html = links.filter({ hasText: 'HTML label' })
    const line = editor.locator('[data-source-line="3"]')
    await expect(line).toHaveText('Markdown · HTML label · End')
    await expect(editor.locator('[data-source-line="5"]')).toHaveText('')
    const label = source.indexOf('HTML label')
    const selected = source.slice(label + 1, label + 9)
    const points = await editor.evaluate((element, from) => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return [from + 1, from + 9].map(position => {
        const rect = view.coordsAtPos(position)!
        return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
      })
    }, label)
    await session.page.mouse.move(points[0].x, points[0].y)
    await session.page.mouse.down()
    await expect(line).toHaveText('Markdown · HTML label · End')
    await session.page.mouse.move(points[1].x, points[1].y, { steps: 10 })
    await session.page.mouse.up()
    await expect.poll(() => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
    })).toBe(selected)
    await session.page.keyboard.press('ControlOrMeta+Shift+c')
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected)
    await session.page.keyboard.press('ControlOrMeta+c')
    await expect.poll(() => session.app.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find(item => item.types.includes('text/html'))
      return item ? (await item.getType('text/html')).text() : ''
    })).toContain(`href="#section" rel="noreferrer noopener">${selected}</a>`)

    await editor.locator('[data-source-line="9"]').click()
    await session.page.keyboard.press('ControlOrMeta+End')
    await session.page.keyboard.press('ControlOrMeta+v')
    await expect(links.filter({ hasText: selected })).toHaveCount(2)
    await session.page.keyboard.press('ControlOrMeta+z')

    await html.click()
    await expect(line).toHaveText('Markdown · <a href="#section">HTML label</a> · End')
    await links.filter({ hasText: 'Markdown' }).click()
    await expect(line).toHaveText('[Markdown](#section "Title") · HTML label · End')
    await setContextMenuChoice(session, 'copy-link')
    await html.click({ button: 'right' })
    await expect.poll(() => session.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('#section')
    await html.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
    await expect.poll(() => editor.evaluate(element => {
      const view = Reflect.get(element, 'cmTile').root.view as import('@codemirror/view').EditorView
      return view.state.doc.lineAt(view.state.selection.main.head).number
    })).toBe(5)
    await session.page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => readFile(destination, 'utf8')).toBe(source)
    expect(session.errors).toEqual([])
  } finally {
    await stopDesktop(session)
  }
})
