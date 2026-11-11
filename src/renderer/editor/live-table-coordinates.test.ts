import { describe, expect, it } from 'vitest'
import { LiveTableWidget } from './live-table'
import { parseTableSource } from './table-model'

function rectangle(top: number, height = 24): DOMRect {
  return { x: 20, y: top, left: 20, right: 140, top, bottom: top + height, width: 120, height, toJSON: () => ({}) }
}

function fixture(source = `| first | second |\n| --- | --- |\n${Array.from({ length: 24 }, (_, row) => `| row ${row + 1} | value |`).join('\n')}`) {
  const offset = 100
  const widget = new LiveTableWidget({ from: offset, to: offset + source.length, source, firstLine: 5, lastLine: 30, html: '', kind: 'table' }, {
    theme: 'light', focusMode: false, readOnly: false, resolveResource: async value => value, onLinkOpen: () => undefined,
  })
  const cells = parseTableSource(source, offset).cells.map(sourceCell => {
    const node = { textContent: sourceCell.content } as Node
    const rect = rectangle(200 + sourceCell.row * 40)
    return {
      source: sourceCell, node, rect,
      dataset: { sourceFrom: String(sourceCell.from), sourceTo: String(sourceCell.to) },
      contains: (target: Node | null) => target === node,
      getBoundingClientRect: () => rect,
    }
  })
  let selection: { anchorNode: Node; anchorOffset: number; focusNode: Node; focusOffset: number } | null = null
  let caretRect = rectangle(0)
  const dom = {
    querySelectorAll: () => cells,
    ownerDocument: {
      getSelection: () => selection,
      createRange: () => {
        let text = ''
        return {
          selectNodeContents: () => undefined,
          setEnd: (node: Node, offset: number) => { text = node.textContent?.slice(0, offset) ?? '' },
          setStart: () => undefined,
          collapse: () => undefined,
          toString: () => text,
          getBoundingClientRect: () => caretRect,
        }
      },
    },
  } as unknown as HTMLElement
  const focus = (index: number, anchor: number, head: number, rect: DOMRect) => {
    const cell = cells[index]
    selection = { anchorNode: cell.node, anchorOffset: anchor, focusNode: cell.node, focusOffset: head }
    caretRect = rect
    return selection
  }
  return { widget, dom, cells, offset, focus }
}

describe('live table source coordinates', () => {
  it('maps positions in the first and last body rows to their own cell rectangles', () => {
    const f = fixture()
    for (const row of [1, 24]) {
      const cell = f.cells.find(value => value.source.row === row)!
      expect(f.widget.coordsAt(f.dom, cell.source.from - f.offset)).toEqual(cell.rect)
    }
    expect(f.widget.coordsAt(f.dom, 0)).toBeNull()
  })

  it('measures the native focus caret without collapsing a backward selection', () => {
    const f = fixture()
    const cell = f.cells[38]
    const caret = rectangle(cell.rect.top + 7, 18)
    const selection = f.focus(38, 5, 2, caret)
    expect(f.widget.coordsAt(f.dom, cell.source.from + 2 - f.offset)).toEqual(caret)
    expect(selection.anchorOffset).toBe(5)
    expect(selection.focusOffset).toBe(2)
    expect(f.widget.coordsAt(f.dom, cell.source.from + 5 - f.offset)).toEqual(cell.rect)
  })

  it('maps native unescaped input to its escaped Markdown source position', () => {
    const f = fixture('| first | second |\n| --- | --- |\n| a\\|b | value |')
    const cell = f.cells[2]
    cell.node.textContent = 'a|b'
    const caret = rectangle(cell.rect.top + 6, 18)
    f.focus(2, 3, 3, caret)
    expect(f.widget.coordsAt(f.dom, cell.source.to - f.offset)).toEqual(caret)
    expect(f.widget.coordsAt(f.dom, cell.source.to - 1 - f.offset)).toEqual(cell.rect)
  })

  it('uses the cell rectangle when an empty native range has no line box', () => {
    const f = fixture('| first | second |\n| --- | --- |\n|  | value |')
    const cell = f.cells[2]
    f.focus(2, 0, 0, rectangle(0, 0))
    expect(f.widget.coordsAt(f.dom, cell.source.from - f.offset)).toEqual(cell.rect)
  })

  it('does not use the focused caret when coordinates are requested for another row', () => {
    const f = fixture()
    const other = f.cells[48]
    f.focus(2, 1, 1, rectangle(247, 18))
    expect(f.widget.coordsAt(f.dom, other.source.from + 1 - f.offset)).toEqual(other.rect)
  })
})
