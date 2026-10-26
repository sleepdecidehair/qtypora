import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { previewContentLength, supportsPreview } from './preview-budget'
import { getMarkdownParser } from './markdown-parser'

const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(1024 * 1024)]).toString('base64')

describe('preview resource budgets', () => {
  it('renders a normal document with large safe inline images while counting actual prose and rejecting disguised data', () => {
    const content = `# Image\n\n![pixel](${png})\n`
    expect(previewContentLength(content)).toBeLessThan(1000)
    expect(supportsPreview(EditorState.create({ doc: content }))).toBe(true)
    expect(previewContentLength(`<img src="${png}">`)).toBeLessThan(1000)
    expect(previewContentLength(png)).toBeGreaterThan(200000)
    expect(previewContentLength(`![fake](data:image/png;base64,${'a'.repeat(300000)})`)).toBeGreaterThan(200000)
  })
  it('caps token amplification with an explicit source fallback', () => {
    const source = '- text\n'.repeat(14000)
    const html = getMarkdownParser().render(source)
    expect(html).toContain('md-preview-limit')
    expect(html).toContain('完整源码')
    expect(html).toContain('- text\n- text')
  })
})
