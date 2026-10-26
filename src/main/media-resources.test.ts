import { describe, expect, it } from 'vitest'
import { parseByteRange } from './media-resources'

describe('media byte ranges', () => {
  it('supports bounded, open and suffix ranges while clamping an oversized end', () => {
    expect(parseByteRange(null, 100)).toBeNull()
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=80-', 100)).toEqual({ start: 80, end: 99 })
    expect(parseByteRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 })
    expect(parseByteRange('bytes=20-200', 100)).toEqual({ start: 20, end: 99 })
    expect(parseByteRange('bytes=-200', 100)).toEqual({ start: 0, end: 99 })
  })
  it('rejects unsatisfiable, multipart, malformed and unsafe integer ranges', () => {
    for (const header of ['bytes=100-', 'bytes=2-1', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bytes=999999999999999999999-', 'bytes=x-y']) expect(parseByteRange(header, 100)).toBe('invalid')
    expect(parseByteRange('bytes=0-0', 0)).toBe('invalid')
  })
})
