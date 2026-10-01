import type { ResourceSize } from './resource-fit'

export interface ResourcePoint { x: number; y: number }
export interface ResourceViewport extends ResourcePoint {
  natural: ResourceSize
  available: ResourceSize
  scale: number
}

export const MAX_RESOURCE_SCALE = 8

function validSize(size: ResourceSize): boolean {
  return [size.width, size.height].every(value => Number.isFinite(value) && value > 0)
}

export function resourceFitScale(view: Pick<ResourceViewport, 'natural' | 'available'>): number {
  return Math.min(1, view.available.width / view.natural.width, view.available.height / view.natural.height)
}

export function resourceMinScale(view: ResourceViewport): number {
  return Math.min(0.1, resourceFitScale(view))
}

function constrain(view: ResourceViewport): ResourceViewport {
  const position = (offset: number, length: number, available: number): number => length <= available
    ? (available - length) / 2
    : Math.min(0, Math.max(available - length, offset))
  return { ...view, x: position(view.x, view.natural.width * view.scale, view.available.width), y: position(view.y, view.natural.height * view.scale, view.available.height) }
}

export function fitResourceViewport(natural: ResourceSize, available: ResourceSize): ResourceViewport | null {
  if (!validSize(natural) || !validSize(available)) return null
  const view = { natural, available, scale: 1, x: 0, y: 0 }
  return constrain({ ...view, scale: resourceFitScale(view) })
}

/** Retain the image point under the cursor, unless reaching an image edge requires centering/clamping. */
export function zoomResourceViewport(view: ResourceViewport, scale: number, anchor: ResourcePoint): ResourceViewport {
  if (![scale, anchor.x, anchor.y].every(Number.isFinite)) return view
  const nextScale = Math.max(resourceMinScale(view), Math.min(MAX_RESOURCE_SCALE, scale))
  const ratio = nextScale / view.scale
  return constrain({ ...view, scale: nextScale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio })
}

export function panResourceViewport(view: ResourceViewport, delta: ResourcePoint): ResourceViewport {
  if (![delta.x, delta.y].every(Number.isFinite)) return view
  return constrain({ ...view, x: view.x + delta.x, y: view.y + delta.y })
}

export function resizeResourceViewport(view: ResourceViewport, available: ResourceSize): ResourceViewport {
  if (!validSize(available)) return view
  if (Math.abs(view.scale - resourceFitScale(view)) < 0.000001) return fitResourceViewport(view.natural, available) ?? view
  // Preserve the detail at the viewport center when resizing a zoomed window.
  return constrain({ ...view, available, x: view.x + (available.width - view.available.width) / 2, y: view.y + (available.height - view.available.height) / 2 })
}
