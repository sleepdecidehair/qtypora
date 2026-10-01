import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { liveBlocks } from './live-blocks'

const blocks = (doc: string) => liveBlocks(EditorState.create({ doc }))

describe('live HTML disclosure block boundaries', () => {
  it('keeps the summary, Markdown body and closing tag in one preview block', () => {
    const disclosure = '<details>\n<summary>ONB-12 · 语言与设备（4 条）</summary>\n\n#### 中文界面文案\n\n正文 **粗体**\n\n1. 操作步骤\n\n| 标题 | 值 |\n| --- | --- |\n| 内容 | 完成 |\n\n</details>'
    const doc = '前文\n\n' + disclosure + '\n\n后文'
    const result = blocks(doc)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ from: doc.indexOf('<details>'), to: doc.indexOf('\n\n后文'), source: disclosure, kind: 'html' })
    expect(result[0].html).toContain('<h4>中文界面文案</h4>')
    expect(result[0].html).toContain('<strong>粗体</strong>')
    expect(result[0].html).toContain('<table>')
    expect(result[0].html.trimEnd()).toMatch(/<\/details>$/)
  })
  it('groups nested disclosures without swallowing an adjacent group or trailing paragraph', () => {
    const first = '<details>\n<summary>外层</summary>\n\n外层正文\n\n<details>\n<summary>内层</summary>\n\n内层正文\n\n</details>\n\n外层末尾\n\n</details>'
    const second = '<details open>\n<summary>第二组</summary>\n\n第二组正文\n\n</details>'
    const result = blocks(first + '\n\n' + second + '\n\n文档末尾')
    expect(result.map(block => block.source)).toEqual([first, second])
  })
  it('ignores closing tags written as code when matching the real closing tag', () => {
    const disclosure = '<details>\n<summary>源码示例</summary>\n\n```html\n</details>\n```\n\n后续正文\n\n</details>'
    const result = blocks(disclosure + '\n\n后文')
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe(disclosure)
    expect(result[0].html).toContain('&lt;/details&gt;')
    expect(result[0].html).toContain('<p>后续正文</p>')
  })
  it('ignores tag-like text in HTML comments and quoted attributes', () => {
    const disclosure = '<details title="literal </details>">\n<summary>注释示例</summary>\n\n<!-- </details> -->\n\n正文\n\n</details>'
    expect(blocks(disclosure + '\n\n后文').map(block => block.source)).toEqual([disclosure])
  })
  it('keeps one-line HTML disclosures intact', () => {
    const disclosure = '<details><summary>标题</summary><p>内容</p></details>'
    expect(blocks(disclosure + '\n\n后文').map(block => block.source)).toEqual([disclosure])
  })
  it('leaves body paragraphs exposed while a disclosure has no closing tag', () => {
    const doc = '<details>\n<summary>尚未写完</summary>\n\n正文\n\n后文'
    expect(blocks(doc).some(block => block.source.includes('正文'))).toBe(false)
  })
  it('does not treat disclosure markup inside a code fence or escaped text as a folding block', () => {
    expect(blocks('```html\n<details>\n<summary>示例</summary>\n\n内容\n\n</details>\n```')).toEqual([])
    expect(blocks('\\<details>\n\\<summary>示例\\</summary>\n\n内容\n\n\\</details>')).toEqual([])
  })
})
