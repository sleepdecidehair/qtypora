import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchDesktop, openFixture, stopDesktop } from './desktop-helpers'

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
