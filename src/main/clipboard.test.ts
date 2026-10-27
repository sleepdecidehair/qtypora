import { describe, expect, it } from 'vitest'
import { validClipboardRtf, validateClipboard } from './clipboard'
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
  it('accepts the bounded RTF text subset and rejects executable or malformed clipboard payloads', () => {
    const rtf = '{\\rtf1\\ansi\\deff0\\uc1{\\fonttbl{\\f0\\fnil Arial;}}\\pard \\b bold\\b0 \\u20013? \\{quoted\\}\\par }'
    expect(validClipboardRtf(rtf)).toBe(true)
    expect(validateClipboard({ text: 'bold 中', html: '<b>bold</b>', rtf })).toEqual({ text: 'bold 中', html: '<b>bold</b>', rtf })
    for (const bad of ['{\\rtf1{\\object\\objdata 123}}', '{\\rtf1{\\field\\fldinst dangerous}}', '{\\rtf1\\pict 00}', '{\\rtf1}outside', '{\\rtf1 ' + '{'.repeat(64) + 'x' + '}'.repeat(65), '{\\rtf1 中文}', '{\\rtf1\\u1234567?}']) {
      expect(validClipboardRtf(bad)).toBe(false)
      expect(() => validateClipboard({ text: '', rtf: bad })).toThrow()
    }
  })
})
