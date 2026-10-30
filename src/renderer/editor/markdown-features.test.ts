import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { DEFAULT_MARKDOWN_OPTIONS, effectiveMarkdownOptions, normalizeMarkdownOptions } from '../../shared/markdown-options'
import { getMarkdownParser } from './markdown-parser'
import { documentMetadata, readFrontMatter } from './markdown-features'
import { headingIndex, resolveHeading } from '../hooks/outline'
import { markdownOptionsFacet } from './markdown-config'
import { liveBlocks } from './live-blocks'
import { inlinePreviewSpans } from './live-inline'
import { fenceCreation } from './live-code'
import { editorLocale, editorText } from './editor-i18n'

const options = { ...DEFAULT_MARKDOWN_OPTIONS, alerts: true }
const parser = getMarkdownParser(options)
const state = (doc: string) => EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of(options)] })

describe('document structure compatibility', () => {
  it('keeps YAML source locations and excludes its apparent headings and executable fields', () => {
    const source = '---\ntitle: 文档\nauthor: [甲, 乙]\nappend-head: "<script>bad()</script>"\ncontent: |\n  # hidden\n---\n\n# Visible\n'
    expect(documentMetadata(source)).toEqual({ title: '文档', author: '甲, 乙' })
    expect(headingIndex(source)).toEqual([{ level: 1, text: 'Visible', line: 9, slug: 'visible' }])
    expect(liveBlocks(state(source))[0]).toMatchObject({ firstLine: 1, lastLine: 7, kind: 'front-matter', source: source.split('\n').slice(0, 7).join('\n') })
  })
  it('does not consume unclosed blocks and preserves invalid YAML without resolving aliases', () => {
    expect(readFrontMatter('---\ntitle: unclosed')).toBeNull()
    expect(readFrontMatter('---\na: [oops\n---')?.error).toContain('YAML')
    expect(readFrontMatter('---\na: &a [x]\nb: *a\n---')?.error).toContain('别名')
    expect(readFrontMatter('paragraph\n---\ntitle: later\n---')).toBeNull()
  })
  it('builds a single collision-free heading index for TOC, duplicate Unicode headings and exports', () => {
    const source = '[TOC]\n\n# 标题 *A*\n\n# 标题 A\n\n# 标题 A-1\n\nSetext\n------\n\n```md\n# hidden\n[toc]\n```\n\n$$\n# hidden math\n$$'
    expect(headingIndex(source).map(item => item.slug)).toEqual(['标题-a', '标题-a-1', '标题-a-1-1', 'setext'])
    const html = parser.render(source)
    expect(html.match(/class="md-toc"/g)).toHaveLength(1)
    expect(html).toContain('href="#标题-a-1"')
    expect(html).toContain('id="标题-a-1"')
    expect(resolveHeading(source, '#%E6%A0%87%E9%A2%98-a-1')?.line).toBe(5)
    expect(resolveHeading(source, '#%broken')).toBeNull()
    expect(resolveHeading(source, '#标题')).toBeNull()
  })
  it('renders Typora TOC aliases without changing source or interpreting fenced examples', () => {
    for (const marker of ['[TOC]', '{:toc}', '{:TOC}', '[[_TOC_]]']) {
      const source = `${marker}\n\n# 标题\n\n\`\`\`md\n${marker}\n\`\`\``
      const editor = state(source)
      const blocks = liveBlocks(editor).filter(block => block.kind === 'toc')
      expect(blocks).toHaveLength(1)
      expect(blocks[0].source).toBe(marker)
      expect(blocks[0].html).toContain('href="#标题"')
      expect(parser.render(source).match(/class="md-toc"/g)).toHaveLength(1)
      expect(editor.doc.toString()).toBe(source)
      expect(getMarkdownParser({ ...options, toc: false }).render(source)).not.toContain('class="md-toc"')
      expect(getMarkdownParser({ ...options, strictMode: true }).render(source)).not.toContain('class="md-toc"')
    }
    for (const marker of ['[[_toc_]]', '{: toc}', '{:toc} extra', 'prefix {:toc}']) {
      expect(parser.render(`${marker}\n\n# title`)).not.toContain('class="md-toc"')
    }
    expect(parser.render('> {:toc}\n\n- [[_TOC_]]\n\n# title')).not.toContain('class="md-toc"')
  })
  it('renders all five Alerts without confusing unknown types, nested content or fenced examples', () => {
    for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      const html = parser.render(`> [!${type}]\n> **正文**\n>\n> - 保留列表`)
      expect(html).toContain(`md-alert-${type.toLowerCase()}`)
      expect(html).toContain('<strong>正文</strong>')
      expect(html).toContain('<li>保留列表</li>')
    }
    expect(parser.render('> [!CUSTOM]\n> test')).not.toContain('md-alert')
    expect(parser.render('```\n> [!NOTE]\n```')).not.toContain('md-alert')
    expect(liveBlocks(state('> [!NOTE]\n> body\n\ntext'))[0]).toMatchObject({ kind: 'alert', firstLine: 1, lastLine: 2 })
  })
  it('localizes generated Alert, front matter and TOC labels without translating source or leaking the cached locale', () => {
    const source = '---\ntitle: 用户原文\nbroken: [x\n---\n\n[toc]\n\n# 用户原文\n\n> [!WARNING]\n> 用户原文\n\nend'
    const en = parser.render(source, { locale: 'en-US' })
    expect(en).toContain('YAML front matter')
    expect(en).toContain('Invalid YAML syntax; the source has been preserved.')
    expect(en).toContain('aria-label="Table of contents"')
    expect(en).toContain('aria-label="Warning"')
    expect(en).toContain('用户原文')
    const zh = parser.render(source)
    expect(zh).toContain('YAML 前置信息')
    expect(zh).toContain('aria-label="警告"')
    const editor = EditorState.create({ doc: source, selection: { anchor: source.length }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of(options), editorLocale.of('en-US')] })
    const blocks = liveBlocks(editor)
    expect(blocks.find(block => block.kind === 'alert')?.html).toContain('aria-label="Warning"')
    expect(blocks.find(block => block.kind === 'front-matter')?.html).toContain('YAML front matter')
    expect(editor.doc.toString()).toBe(source)
    expect(editorText('en-US', '图片导出失败（{resource}）：{message}', { resource: '用户/$&.png', message: '原样错误' })).toBe('Image export failed (用户/$&.png): 原样错误')
  })
  it('allows independent parser configurations and safely disables extensions', () => {
    const disabled = getMarkdownParser({ ...options, frontMatter: false, toc: false, alerts: false, highlight: false, subscript: false, superscript: false, inlineMath: false, emoji: false, diagrams: false })
    const text = '[toc]\n\n> [!NOTE]\n> ==mark== ~sub~ ^sup^ $x$ :smile:\n\n```mermaid\ngraph TD\nA-->B\n```'
    const html = disabled.render(text)
    expect(html).not.toMatch(/md-toc|md-alert|<mark>|<sub>|<sup>|data-math|data-mermaid/)
    expect(html).toContain(':smile:')
    expect(parser.render('==mark== $x$')).toContain('<mark>mark</mark>')
    expect(parser.render('[toc]\n\n# title')).toContain('md-toc')
  })
  it('uses a CommonMark preset consistently while preserving saved extended syntax preferences', () => {
    const saved = { ...options, strictMode: true }
    const strict = getMarkdownParser(saved)
    const source = '---\ntitle: Literal\n---\n\n[toc]\n\n# Heading\n\n~~strike~~ ==mark== H~2~O x^2^ :smile: $x$\n\n- [x] task\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n$$\nx=1\n$$\n\n```mermaid\ngraph TD\nA-->B\n```\n\nhttps://example.test\n'
    const html = strict.render(source)
    expect(html).not.toMatch(/md-front-matter|md-toc|md-math|md-mermaid|<mark>|<sub>|<sup>|<s>|<table>|checkbox|href="https/)
    expect(html).toContain('<h1 id="heading">Heading</h1>')
    expect(html).toContain('~~strike~~ ==mark== H~2~O x^2^ :smile: $x$')
    const editor = EditorState.create({ doc: source, selection: { anchor: source.length }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of(saved)] })
    expect(liveBlocks(editor).map(block => block.kind)).not.toContain('table')
    expect(inlinePreviewSpans(editor).some(span => span.className === 'cm-live-strike' || span.replacement === '😄')).toBe(false)
    expect(effectiveMarkdownOptions(saved).emoji).toBe(false)
    expect(saved.emoji).toBe(true)
    expect(getMarkdownParser({ ...saved, strictMode: false }).render('==mark==')).toContain('<mark>mark</mark>')
  })
})

describe('Markdown preferences and editing', () => {
  it('migrates older settings, rejects malformed values and leaves callers independent', () => {
    expect(normalizeMarkdownOptions(undefined)).toEqual(DEFAULT_MARKDOWN_OPTIONS)
    expect(normalizeMarkdownOptions({ toc: false }).toc).toBe(false)
    expect(() => normalizeMarkdownOptions({ toc: 'false' })).toThrow()
    expect(() => normalizeMarkdownOptions({ codeIndentSize: 0 })).toThrow()
    expect(() => normalizeMarkdownOptions({ defaultCodeLanguage: 'js\nexecute' })).toThrow()
  })
  it('renders extended inline styles outside code and retains source when the caret enters them', () => {
    const doc = '==highlight== H~2~O x^2^ :smile: `==literal==`\n\nend'
    const current = state(doc)
    const spans = inlinePreviewSpans(current)
    expect(spans.some(span => span.className === 'cm-live-highlight' && span.from === 0)).toBe(true)
    expect(spans.some(span => span.replacement === '😄')).toBe(true)
    expect(spans.filter(span => span.className === 'cm-live-highlight')).toHaveLength(1)
    const active = current.update({ selection: { anchor: 4 } }).state
    expect(inlinePreviewSpans(active).some(span => span.hidden && span.from === 0)).toBe(false)
    expect(current.doc.toString()).toBe(doc)
  })
  it('uses the default language only for a newly created unlabelled fence', () => {
    const configured = EditorState.create({ doc: '```', selection: { anchor: 3 }, extensions: [markdown({ base: markdownLanguage }), markdownOptionsFacet.of({ ...options, defaultCodeLanguage: 'python' })] })
    const transaction = fenceCreation(configured)
    expect(transaction).not.toBeNull()
    const next = configured.update(transaction!).state
    expect(next.doc.toString()).toBe('```python\n\n```')
    expect(next.selection.main.head).toBe(10)
  })
})

describe('stable cached rendering and bounded document expansion', () => {
  it('does not mutate cached paragraph classes across repeated rendering', () => {
    const environment = {}
    const tokens = parser.parse('![image](pixel.png)', environment)
    const first = parser.renderer.render(tokens, parser.options, environment)
    for (let count = 0; count < 4; count++) expect(parser.renderer.render(tokens, parser.options, environment)).toBe(first)
    expect(first).toContain('class="md-image-paragraph"')
  })
  it('parses Alert footnotes once and preserves their source line', () => {
    const environment: Record<string, unknown> = {}
    const html = parser.render('> [!NOTE]\n> inline ^[note] and named[^n] $x$\n\n[^n]: note', environment)
    expect(html).toContain('id="fnref1"')
    expect(html).toContain('id="fnref2"')
    expect(html).not.toContain('id="fn3"')
    expect(environment.mathExpressions).toEqual([{ source: 'x', display: false, line: 2 }])
  })
  it('bounds repeated TOC entries while keeping all headings and source available', () => {
    const source = '[toc]\n\n'.repeat(100) + '# same\n'.repeat(1000)
    const html = parser.render(source)
    expect(html.match(/<h1 /g)).toHaveLength(1000)
    expect(html.match(/class="md-toc-level-1"/g)).toHaveLength(5000)
    expect(html).toContain('侧栏大纲')
    expect(html.length).toBeLessThan(400000)
  })
  it('renders full-paragraph audio and video through a source-preserving live block', () => {
    const source = '<audio src="tone.wav"></audio>\n\n<video src="clip.mp4"></video>\n'
    const blocks = liveBlocks(state(source))
    expect(blocks.map(block => block.kind)).toEqual(['html', 'html'])
    expect(blocks[0].source).toBe('<audio src="tone.wav"></audio>')
  })
})
