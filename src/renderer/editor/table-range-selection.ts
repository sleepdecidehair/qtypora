interface TablePosition { row: number; column: number }
interface RangeSelectionCallbacks {
  canSelect: () => boolean
  start: (cell: HTMLElement) => void
  select: (from: TablePosition, to: TablePosition) => void
}

/** Alt-drag owns only the rectangle gesture; an ordinary drag keeps native text selection. */
export function tableRangeSelection(container: HTMLElement, callbacks: RangeSelectionCallbacks): () => void {
  let pointer: number | null = null
  let anchor: TablePosition | null = null
  let end: TablePosition | null = null
  const owner = container.ownerDocument
  const cellAt = (target: EventTarget | null): HTMLElement | null => {
    const cell = target instanceof Element ? target.closest<HTMLElement>('th[data-row],td[data-row]') : null
    return cell?.closest('[data-testid="live-table"]') === container ? cell : null
  }
  const position = (cell: HTMLElement): TablePosition => ({ row: Number(cell.dataset.row), column: Number(cell.dataset.column) })
  const finish = () => {
    const previous = pointer
    pointer = null; anchor = null; end = null
    container.classList.remove('cm-table-selecting-range')
    if (previous !== null && container.hasPointerCapture(previous)) container.releasePointerCapture(previous)
  }
  const start = (event: PointerEvent) => {
    const cell = cellAt(event.target)
    if (!event.altKey || event.button !== 0 || !cell || !callbacks.canSelect()) return
    event.preventDefault(); event.stopPropagation()
    finish()
    pointer = event.pointerId; anchor = position(cell); end = anchor
    callbacks.start(cell)
    callbacks.select(anchor, end)
    container.classList.add('cm-table-selecting-range')
    container.setPointerCapture(pointer)
  }
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer || !anchor) return
    event.preventDefault(); event.stopPropagation()
    if (!callbacks.canSelect()) { finish(); return }
    const cell = cellAt(owner.elementFromPoint(event.clientX, event.clientY))
    if (!cell) return
    const next = position(cell)
    if (next.row === end?.row && next.column === end?.column) return
    end = next
    callbacks.select(anchor, next)
  }
  const stop = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return
    event.preventDefault(); event.stopPropagation(); finish()
  }
  const lost = (event: PointerEvent) => { if (event.pointerId === pointer) finish() }
  container.addEventListener('pointerdown', start)
  container.addEventListener('pointermove', move)
  container.addEventListener('pointerup', stop)
  container.addEventListener('pointercancel', stop)
  container.addEventListener('lostpointercapture', lost)
  owner.defaultView?.addEventListener('blur', finish)
  return () => {
    finish()
    container.removeEventListener('pointerdown', start)
    container.removeEventListener('pointermove', move)
    container.removeEventListener('pointerup', stop)
    container.removeEventListener('pointercancel', stop)
    container.removeEventListener('lostpointercapture', lost)
    owner.defaultView?.removeEventListener('blur', finish)
  }
}
