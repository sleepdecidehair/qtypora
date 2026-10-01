import type { EditorView } from '@codemirror/view'

export interface SemanticScrollAnchor { line: number; fraction: number }
interface SourceRange { start: number; end: number }

const clampFraction = (value: number): number => Math.max(0, Math.min(1, value))

export function anchorProgress(anchor: SemanticScrollAnchor, range: SourceRange): number {
  return clampFraction((anchor.line - range.start + clampFraction(anchor.fraction)) / Math.max(1, range.end - range.start + 1))
}

export function progressAnchor(range: SourceRange, progress: number): SemanticScrollAnchor {
  const position = range.start + clampFraction(progress) * Math.max(1, range.end - range.start + 1)
  const line = Math.min(range.end, Math.floor(position))
  return { line, fraction: clampFraction(position - line) }
}

function sourceRange(element: HTMLElement): SourceRange | null {
  const start = Number(element.dataset.sourceLine)
  const end = Number(element.dataset.sourceEnd || start)
  return Number.isInteger(start) && start > 0 && Number.isInteger(end) && end >= start ? { start, end } : null
}

function readingTop(root: HTMLElement): number {
  const search = root.querySelector<HTMLElement>('.reading-search')
  return root.getBoundingClientRect().top + (search?.getBoundingClientRect().height || 0)
}

function readingBlocks(article: HTMLElement): { element: HTMLElement; range: SourceRange; rect: DOMRect }[] {
  return Array.from(article.querySelectorAll<HTMLElement>('[data-source-line]')).flatMap((element) => {
    const range = sourceRange(element)
    const rect = element.getBoundingClientRect()
    return range && rect.height > 0 ? [{ element, range, rect }] : []
  })
}

export function readReadingAnchor(root: HTMLElement, article: HTMLElement): SemanticScrollAnchor | null {
  const top = readingTop(root)
  const blocks = readingBlocks(article)
  const intersecting = blocks.filter(({ rect }) => rect.top <= top + 0.5 && rect.bottom > top + 0.5)
  // Prefer the row/list item/paragraph over its encompassing table or list.
  intersecting.sort((a, b) => (a.range.end - a.range.start) - (b.range.end - b.range.start) || a.rect.height - b.rect.height)
  const target = intersecting[0] || blocks.filter(({ rect }) => rect.top >= top).sort((a, b) => a.rect.top - b.rect.top || (a.range.end - a.range.start) - (b.range.end - b.range.start))[0] || blocks.at(-1)
  return target ? progressAnchor(target.range, (top - target.rect.top) / target.rect.height) : null
}

export function restoreReadingAnchor(root: HTMLElement, article: HTMLElement, anchor: SemanticScrollAnchor): void {
  const blocks = readingBlocks(article)
  const enclosing = blocks.filter(({ range }) => range.start <= anchor.line && range.end >= anchor.line)
  enclosing.sort((a, b) => (a.range.end - a.range.start) - (b.range.end - b.range.start) || a.rect.height - b.rect.height)
  const target = enclosing[0] || blocks.find(({ range }) => range.start >= anchor.line) || blocks.at(-1)
  if (target) root.scrollTop += target.rect.top - readingTop(root) + anchorProgress(anchor, target.range) * target.rect.height
}

export function readSourceAnchor(view: EditorView): SemanticScrollAnchor {
  const top = (view.scrollDOM.getBoundingClientRect().top - view.documentTop) / view.scaleY
  const block = view.lineBlockAtHeight(Math.max(0, top))
  return { line: view.state.doc.lineAt(block.from).number, fraction: clampFraction((top - block.top) / Math.max(1, block.height)) }
}
