import { describe, expect, it } from 'vitest'
import { dataImageInfo, isSafeDataImage } from './data-image'

describe('embedded raster image data', () => {
  it('accepts image signatures with strict base64 and rejects mismatched or executable content', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(dataImageInfo(png)).toEqual({ mime: 'image/png', byteLength: 8 })
    expect(isSafeDataImage('data:image/jpeg;base64,iVBORw0KGgo=')).toBe(false)
    expect(isSafeDataImage('data:image/png;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeDataImage('data:image/svg+xml;base64,PHN2Zy8+')).toBe(false)
    expect(isSafeDataImage(png + '\n')).toBe(false)
    expect(isSafeDataImage(png + '=')).toBe(false)
    expect(isSafeDataImage('data:image/png;base64,' + 'a'.repeat(14_000_000))).toBe(false)
  })
})
