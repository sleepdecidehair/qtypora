import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DOMPurify from 'dompurify'
import { fitResourceViewport, MAX_RESOURCE_SCALE, panResourceViewport, resizeResourceViewport, resourceMinScale, zoomResourceViewport, type ResourcePoint, type ResourceViewport } from './resource-viewport'
import type { ViewedResource } from './context-resource'

interface PointerDrag extends ResourcePoint { id: number }

export function ResourceViewer({ resource, onClose }: { resource: ViewedResource; onClose: () => void }): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const mathRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<ResourceViewport | null>(null)
  const dragRef = useRef<PointerDrag | null>(null)
  const [viewport, setViewport] = useState<ResourceViewport | null>(null)
  const [hasError, setHasError] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const uri = useMemo(() => resource.kind === 'diagram' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(resource.source)}` : resource.source, [resource])
  const math = useMemo(() => resource.kind === 'math' ? DOMPurify.sanitize(resource.source, { USE_PROFILES: { mathMl: true }, FORBID_ATTR: ['href', 'style'] }) : '', [resource])

  const updateViewport = useCallback((next: ResourceViewport | null): void => {
    viewportRef.current = next
    setViewport(next)
  }, [])

  const zoom = useCallback((scale: number, anchor?: ResourcePoint): void => {
    const view = viewportRef.current
    if (view) updateViewport(zoomResourceViewport(view, scale, anchor ?? { x: view.available.width / 2, y: view.available.height / 2 }))
  }, [updateViewport])

  const reset = useCallback((): void => {
    const view = viewportRef.current
    if (view) updateViewport(fitResourceViewport(view.natural, view.available))
  }, [updateViewport])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const image = imageRef.current
    const formula = mathRef.current
    updateViewport(null)
    setHasError(false)
    dragRef.current = null
    setIsDragging(false)
    function measure(): void {
      const natural = image ? { width: image.naturalWidth, height: image.naturalHeight } : { width: formula?.offsetWidth ?? 0, height: formula?.offsetHeight ?? 0 }
      const available = { width: stage!.clientWidth, height: stage!.clientHeight }
      const current = viewportRef.current
      const next = current && current.natural.width === natural.width && current.natural.height === natural.height
        ? resizeResourceViewport(current, available)
        : fitResourceViewport(natural, available)
      if (next) updateViewport(next)
    }
    function failed(): void { updateViewport(null); setHasError(true) }
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    if (formula) observer.observe(formula)
    image?.addEventListener('load', measure)
    image?.addEventListener('error', failed)
    if (image?.complete && !image.naturalWidth) failed()
    else measure()
    return () => { observer.disconnect(); image?.removeEventListener('load', measure); image?.removeEventListener('error', failed) }
  }, [resource, updateViewport])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    function wheel(event: WheelEvent): void {
      event.preventDefault()
      event.stopPropagation()
      const view = viewportRef.current
      if (!view || !event.deltaY) return
      const rect = stage!.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.available.height : 1)
      zoom(view.scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    // React wheel events are passive; this listener prevents scrolling the article behind the viewer.
    stage.addEventListener('wheel', wheel, { passive: false })
    return () => stage.removeEventListener('wheel', wheel)
  }, [zoom])

  useEffect(() => {
    closeRef.current?.focus()
    function keydown(event: KeyboardEvent): void {
      if (event.key === 'Tab') {
        const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        event.preventDefault(); event.stopPropagation(); buttons[next]?.focus()
        return
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
      // Keep editor/global shortcuts from changing the document while the modal has focus.
      event.stopPropagation()
      const view = viewportRef.current
      if (!view || event.altKey || event.metaKey || event.isComposing) return
      if (event.key === '+' || event.key === '=') zoom(view.scale * 1.25)
      else if (event.key === '-') zoom(view.scale / 1.25)
      else if (event.key === '0') reset()
      else if (event.key === '1') zoom(1)
      else if (event.key.startsWith('Arrow')) {
        const step = event.shiftKey ? 160 : 40
        const delta = { x: event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0, y: event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0 }
        updateViewport(panResourceViewport(view, delta))
      } else return
      event.preventDefault()
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [onClose, reset, updateViewport, zoom])

  function stopDrag(): void { dragRef.current = null; setIsDragging(false) }
  const transform = viewport ? `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` : undefined
  return createPortal(<div className="editor-resource-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="editor-resource-viewer" role="dialog" aria-modal="true" aria-label="查看资源" aria-describedby="resource-viewer-help" data-testid="resource-viewer">
      <div className="editor-resource-toolbar">
        <span className="editor-resource-title">{resource.kind === 'diagram' ? '图表' : resource.kind === 'math' ? '公式' : '图片'}</span>
        <button type="button" aria-label="缩小" title="缩小（−）" disabled={!viewport || viewport.scale <= resourceMinScale(viewport)} onClick={() => { if (viewport) zoom(viewport.scale / 1.25) }}>−</button>
        <output aria-label="缩放比例">{viewport ? `${Math.round(viewport.scale * 1000) / 10}%` : '—'}</output>
        <button type="button" aria-label="放大" title="放大（+）" disabled={!viewport || viewport.scale >= MAX_RESOURCE_SCALE} onClick={() => { if (viewport) zoom(viewport.scale * 1.25) }}>+</button>
        <button type="button" disabled={!viewport} title="恢复完整展示（0）" onClick={reset}>适应窗口</button>
        <button type="button" disabled={!viewport} title="100% 原始尺寸（1）" onClick={() => zoom(1)}>原始大小</button>
        <button ref={closeRef} className="editor-resource-close" type="button" aria-label="关闭资源查看" onClick={onClose}>关闭</button>
      </div>
      <div ref={stageRef} className={`editor-resource-stage${isDragging ? ' is-dragging' : ''}`} data-testid="resource-stage"
        onPointerDown={event => {
          if (event.button !== 0 || !viewportRef.current || dragRef.current) return
          event.preventDefault()
          dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
          setIsDragging(true)
        }}
        onPointerMove={event => {
          const drag = dragRef.current, view = viewportRef.current
          if (!drag || !view || drag.id !== event.pointerId) return
          updateViewport(panResourceViewport(view, { x: event.clientX - drag.x, y: event.clientY - drag.y }))
          dragRef.current = { id: drag.id, x: event.clientX, y: event.clientY }
        }}
        onPointerUp={event => { if (dragRef.current?.id === event.pointerId) { event.currentTarget.releasePointerCapture(event.pointerId); stopDrag() } }}
        onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
        {resource.kind === 'math'
          ? <div ref={mathRef} className="editor-resource-content editor-resource-math" style={{ transform, visibility: viewport ? 'visible' : 'hidden' }} dangerouslySetInnerHTML={{ __html: math }} />
          : <img ref={imageRef} key={uri} className="editor-resource-content" src={uri} draggable={false} alt={resource.kind === 'diagram' ? '完整图表' : '原图片'} style={{ transform, width: viewport?.natural.width, height: viewport?.natural.height, visibility: viewport ? 'visible' : 'hidden' }} />}
        {!viewport ? <p className="editor-resource-message" role="status">{hasError ? '资源加载失败，请关闭后检查图片路径。' : '正在加载资源…'}</p> : null}
      </div>
      <p className="editor-resource-help" id="resource-viewer-help">滚轮放大鼠标所在位置 · 拖动查看细节 · + / − 缩放 · 0 恢复全图 · Esc 关闭</p>
    </section>
  </div>, document.body)
}
