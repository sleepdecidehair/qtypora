import { describe, expect, it } from 'vitest'
import { fitResourceViewport, MAX_RESOURCE_SCALE, panResourceViewport, resizeResourceViewport, zoomResourceViewport, type ResourceViewport } from './resource-viewport'

const natural = { width: 2400, height: 1800 }
const available = { width: 800, height: 600 }
const fit = (): ResourceViewport => fitResourceViewport(natural, available)!
const imagePoint = (view: ResourceViewport, x: number, y: number) => ({ x: (x - view.x) / view.scale, y: (y - view.y) / view.scale })

describe('resource detail inspection', () => {
  it('opens complete, centered and proportional, without enlarging small images', () => {
    expect(fit()).toMatchObject({ scale: 1 / 3, x: 0, y: 0 })
    expect(fitResourceViewport({ width: 160, height: 90 }, available)).toMatchObject({ scale: 1, x: 320, y: 255 })
    const tall = fitResourceViewport({ width: 800, height: 2400 }, available)!
    expect(tall).toMatchObject({ scale: 0.25, x: 300, y: 0 })
  })
  it('keeps the same image point under an off-center cursor through zoom and reversal', () => {
    const anchor = { x: 600, y: 210 }
    const view = fit()
    const zoomed = zoomResourceViewport(view, 1, anchor)
    expect(imagePoint(zoomed, anchor.x, anchor.y)).toEqual(imagePoint(view, anchor.x, anchor.y))
    expect(zoomResourceViewport(zoomed, view.scale, anchor)).toEqual(view)
  })
  it('bounds dragging at all image edges and centers axes that fit', () => {
    const zoomed = zoomResourceViewport(fit(), 1, { x: 400, y: 300 })
    expect(panResourceViewport(zoomed, { x: 9999, y: 9999 })).toMatchObject({ x: 0, y: 0 })
    expect(panResourceViewport(zoomed, { x: -9999, y: -9999 })).toMatchObject({ x: -1600, y: -1200 })
    expect(panResourceViewport(fit(), { x: 100, y: -100 })).toEqual(fit())
  })
  it('caps magnification and allows even huge images to return to complete fit', () => {
    expect(zoomResourceViewport(fit(), 100, { x: 400, y: 300 }).scale).toBe(MAX_RESOURCE_SCALE)
    expect(zoomResourceViewport(fit(), 0, { x: 400, y: 300 }).scale).toBe(0.1)
    const huge = fitResourceViewport({ width: 80000, height: 60000 }, available)!
    expect(zoomResourceViewport(huge, -100, { x: 0, y: 0 })).toEqual(huge)
  })
  it('fits a resized window in overview and preserves the center detail after zooming', () => {
    const smaller = { width: 600, height: 400 }
    const overview = resizeResourceViewport(fit(), smaller)
    expect(overview.scale).toBeCloseTo(400 / 1800)
    const zoomed = zoomResourceViewport(fit(), 1, { x: 400, y: 300 })
    const resized = resizeResourceViewport(zoomed, smaller)
    expect(resized.scale).toBe(1)
    expect(imagePoint(resized, 300, 200)).toEqual(imagePoint(zoomed, 400, 300))
  })
  it('recovers a complete overview after panning and zooming', () => {
    const moved = panResourceViewport(zoomResourceViewport(fit(), 4, { x: 700, y: 100 }), { x: -140, y: 90 })
    expect(fitResourceViewport(moved.natural, moved.available)).toEqual(fit())
  })
  it('does not produce invalid transforms for unloaded resources, zero windows or invalid input', () => {
    expect(fitResourceViewport({ width: 0, height: 0 }, available)).toBeNull()
    expect(fitResourceViewport(natural, { width: 0, height: 600 })).toBeNull()
    expect(fitResourceViewport({ width: Infinity, height: 100 }, available)).toBeNull()
    expect(zoomResourceViewport(fit(), NaN, { x: 1, y: 2 })).toEqual(fit())
    expect(panResourceViewport(fit(), { x: Infinity, y: 0 })).toEqual(fit())
    expect(resizeResourceViewport(fit(), { width: 0, height: 0 })).toEqual(fit())
  })
})
