import { EditorSelection } from '@codemirror/state'
import { BlockType, layer, RectangleMarker, type BlockInfo } from '@codemirror/view'

// In preview, a rectangle joining separate source lines also covers the empty
// Markdown lines and heading padding between their rendered text.
export const previewSelection = layer({
  above: false,
  class: 'cm-preview-selectionLayer',
  update: update => update.docChanged || update.selectionSet || update.viewportChanged,
  markers(view) {
    const markers: RectangleMarker[] = []
    const hasWidget = (block: BlockInfo): boolean => Array.isArray(block.type)
      ? block.type.some(hasWidget)
      : block.type !== BlockType.Text

    for (const range of view.state.selection.ranges) {
      if (range.empty) continue
      // A block widget may represent many source lines as one visual object.
      // Preserve CodeMirror's widget selection geometry in that case.
      if (view.viewportLineBlocks.some(block => block.to >= range.from && block.from <= range.to && hasWidget(block))) {
        markers.push(...RectangleMarker.forRange(view, 'cm-selectionBackground', range))
        continue
      }
      const from = Math.max(range.from, view.viewport.from)
      const to = Math.min(range.to, view.viewport.to)
      if (from >= to) continue
      let line = view.state.doc.lineAt(from)
      for (;;) {
        const start = Math.max(from, line.from), end = Math.min(to, line.to)
        if (start < end) markers.push(...RectangleMarker.forRange(view, 'cm-selectionBackground', EditorSelection.range(start, end)))
        if (line.to >= to || line.number === view.state.doc.lines) break
        line = view.state.doc.line(line.number + 1)
      }
    }
    return markers
  },
})
