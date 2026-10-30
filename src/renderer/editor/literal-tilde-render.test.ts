import { describe, expect, it } from 'vitest'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'
import { createMarkdownParser } from './markdown-parser'

describe('literal tildes with extension configurations', () => {
  it.each([true, false])('retains every tilde with subscript %s and real deletion', subscript => {
    const parser = createMarkdownParser({ ...DEFAULT_MARKDOWN_OPTIONS, subscript })
    const html = parser.render('\\~\\~old~~ and ~~deleted~~')
    expect(html).toContain('~~old~~')
    expect(html).not.toContain('<sub>old</sub>')
    expect(html).toContain('<s>deleted</s>')
  })
})

describe('adjacent literal subscript delimiters', () => {
  it.each([true, false])('retains literal tildes with subscript %s', subscript => {
    const parser = createMarkdownParser({ ...DEFAULT_MARKDOWN_OPTIONS, subscript })
    const html = parser.render('x\\~a\\~\\~b\\~' + (subscript ? ' ~real~' : ''))
    expect(html).toContain('x~a~~b~')
    expect(html).not.toContain('<sub>a</sub>')
    expect(html).not.toContain('<sub>b</sub>')
    if (subscript) expect(html).toContain('<sub>real</sub>')
  })
})
