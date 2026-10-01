import { describe, expect, it } from 'vitest'
import { extractHeadings } from './outline'

describe('Markdown outline text and source locations', () => {
  it('preserves literal underscores in identifiers', () => {
    expect(extractHeadings('# POSITION_5\n\n## file_name and foo_bar\n')).toEqual([
      { level: 1, text: 'POSITION_5', line: 1 },
      { level: 2, text: 'file_name and foo_bar', line: 3 },
    ])
  })

  it('removes actual format delimiters while retaining inline code content', () => {
    expect(extractHeadings('# **Bold** _italic_ ~~gone~~ `code_with_ticks`\n')[0]?.text).toBe('Bold italic gone code_with_ticks')
  })

  it('preserves escaped syntax as literal text', () => {
    expect(extractHeadings('# \\*literal\\* \\_literal\\_ \\`literal\\`\n')[0]?.text).toBe('*literal* _literal_ `literal`')
  })

  it('keeps link labels and image alternatives without exposing destinations', () => {
    expect(extractHeadings('# [link_label](https://example.com) ![image_label](local.png)\n')[0]?.text).toBe('link_label image_label')
  })

  it('ignores code blocks, including fences with shorter apparent closers', () => {
    const content = '````md\n# hidden\n```\n## still hidden\n````\n\n    # indented code\n\n# Visible\n'
    expect(extractHeadings(content)).toEqual([{ level: 1, text: 'Visible', line: 9 }])
  })

  it('maps Setext headings and quoted headings to their original lines', () => {
    expect(extractHeadings('Setext_title\n============\n\n> ## Quoted_title\n')).toEqual([
      { level: 1, text: 'Setext_title', line: 1 },
      { level: 2, text: 'Quoted_title', line: 4 },
    ])
  })

  it('decodes entities and ignores inline HTML tags', () => {
    expect(extractHeadings('# Café &amp; <span>label_name</span>\n')[0]?.text).toBe('Café & label_name')
  })

  it('rejects heading-like text without valid Markdown markers', () => {
    expect(extractHeadings('#not a heading\n\n###also_not\n')).toEqual([])
  })
})
