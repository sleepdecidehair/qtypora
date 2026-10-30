import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { createMarkdownParser } from './markdown-parser'

describe('adjacent literal extension delimiters', () => {
  it.each([true, false])('preserves all characters with extensions enabled=%s', enabled => {
    const parser = createMarkdownParser({ ...DEFAULT_MARKDOWN_OPTIONS, inlineMath: enabled, superscript: enabled })
    const html = parser.render('\\$5\\$\\$6\\$ \\^a\\^\\^b\\^')
    expect(html).toContain('$5$$6$ ^a^^b^')
    expect(html).not.toContain('data-math=')
    expect(html).not.toContain('<sup>')
  })
})
