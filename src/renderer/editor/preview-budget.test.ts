import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { MAX_PREVIEW_CHARACTERS, supportsPreview, supportsPreviewLength } from './preview-budget'
import { getMarkdownParser } from './markdown-parser'

const png = (bytes: number) => 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(bytes)]).toString('base64')

describe('preview resource budgets', () => {
  it('keeps small inline data images previewable without exempting large payloads from the raw source limit', () => {
    const small = `# Image\n\n![pixel](${png(32 * 1024)})\n`
    const large = `# Image\n\n![pixel](${png(1024 * 1024)})\n`
    expect(small.length).toBeLessThan(MAX_PREVIEW_CHARACTERS)
    expect(supportsPreview(EditorState.create({ doc: small }))).toBe(true)
    expect(large.length).toBeGreaterThan(MAX_PREVIEW_CHARACTERS)
    expect(supportsPreview(EditorState.create({ doc: large }))).toBe(false)
    expect(supportsPreviewLength(MAX_PREVIEW_CHARACTERS)).toBe(true)
    expect(supportsPreviewLength(MAX_PREVIEW_CHARACTERS + 1)).toBe(false)
  })
  it('caps token amplification with an explicit source fallback', () => {
    const source = '- text\n'.repeat(14000)
    const html = getMarkdownParser().render(source)
    expect(html).toContain('md-preview-limit')
    expect(html).toContain('完整源码')
    expect(html).toContain('- text\n- text')
  })
})
