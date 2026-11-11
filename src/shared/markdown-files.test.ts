import { describe, expect, it } from 'vitest'
import { isMarkdownExtension, isMarkdownFileName } from './markdown-files'

describe('Markdown file recognition', () => {
  it('recognizes Quarto filenames without executing or interpreting them', () => {
    for (const name of ['report.qmd', 'REPORT.QMD', '含空格 报告.QmD']) expect(isMarkdownFileName(name)).toBe(true)
    expect(isMarkdownExtension('.QMD')).toBe(true)
  })

  it('keeps existing formats and rejects misleading suffixes', () => {
    for (const extension of ['md', 'markdown', 'mdown', 'mkd', 'txt']) expect(isMarkdownFileName(`draft.${extension}`)).toBe(true)
    for (const name of ['draft.qmd.exe', 'draft.qmd ', 'qmd', '.qmd']) expect(isMarkdownFileName(name)).toBe(false)
    expect(isMarkdownExtension('qmd')).toBe(false)
  })
})
