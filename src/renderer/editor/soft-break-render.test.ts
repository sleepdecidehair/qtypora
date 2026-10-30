import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { getMarkdownParser } from './markdown-parser'

describe('soft line break setting', () => {
  it('controls whether paragraph soft breaks render as HTML breaks', () => {
    const source = 'first\nsecond'
    expect(getMarkdownParser({ ...DEFAULT_MARKDOWN_OPTIONS, softBreaks: false }).render(source)).toBe('<p>first\nsecond</p>\n')
    expect(getMarkdownParser({ ...DEFAULT_MARKDOWN_OPTIONS, softBreaks: true }).render(source)).toBe('<p>first<br>\nsecond</p>\n')
  })
})
