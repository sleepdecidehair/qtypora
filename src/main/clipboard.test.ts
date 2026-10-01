import { describe, expect, it } from 'vitest'
import { validateClipboard } from './clipboard'
import { MAX_DOCUMENT_BYTES } from './files'

describe('Clipboard boundary', () => {
  it('permits empty text and carries only plain/HTML formats', () => {
    expect(validateClipboard({ text: '', html: '<b>你好</b>', bookmark: 'discarded' })).toEqual({ text: '', html: '<b>你好</b>' })
    expect(validateClipboard({ text: 'a' })).toEqual({ text: 'a' })
  })
  it('rejects missing/wrong data, NUL and oversized UTF-8 content', () => {
    for (const input of [{}, { text: 123 }, { text: 'a\0b' }, { text: 'a', html: false }, { text: '汉'.repeat(Math.ceil(MAX_DOCUMENT_BYTES / 3)) }]) {
      expect(() => validateClipboard(input)).toThrow()
    }
  })
})
