import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { createMarkdownParser } from './markdown-parser'

describe('literal extension markers across hard breaks', () => {
  it.each([true, false])('preserves characters with extensions enabled=%s', enabled => {
    const parser = createMarkdownParser({ ...DEFAULT_MARKDOWN_OPTIONS, highlight: enabled, subscript: enabled, superscript: enabled, inlineMath: enabled })
    const html = parser.render('x\\=\\=a\\\nb\\=\\=\n\nx\\~\\~c\\\nd\\~\\~')
    expect(html).toContain('x==a<br>\nb==')
    expect(html).toContain('x~~c<br>\nd~~')
    expect(html).not.toMatch(/<mark>|<s>|<sub>/)
  })
})
