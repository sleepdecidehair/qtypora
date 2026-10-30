import { describe, expect, it } from 'vitest'
import { compileTyporaTheme, mapTyporaThemeRules } from './typora-theme'

describe('Typora theme selector mapping', () => {
  it('maps headings and supported inline styles consistently to editor, preview and export', () => {
    const result = mapTyporaThemeRules([
      { selector: '#write h1, h2', declarations: [{ property: 'font-size', value: '2em' }, { property: 'color', value: '#333' }] },
      { selector: 'blockquote', declarations: [{ property: 'border-left-color', value: 'red' }] },
      { selector: 'strong', declarations: [{ property: 'font-weight', value: '700' }] },
    ])
    expect(result.editor).toContain(':where(.cm-line).cm-live-heading-1')
    expect(result.editor).toContain('.md-preview-block h1')
    expect(result.editor).toContain(':where(.cm-line).cm-live-heading-2')
    expect(result.editor).toContain('.cm-live-quote')
    expect(result.editor).toContain('.cm-live-strong')
    expect(result.export).toContain('body h1{font-size:2em;color:#333}')
    expect(result.export).toContain('body blockquote{border-left-color:red}')
  })

  it('drops unsupported selectors, properties, variable and resource values', () => {
    const result = mapTyporaThemeRules([
      { selector: 'h1, .toolbar, #write > h2, h3:hover', declarations: [
        { property: 'color', value: 'red' }, { property: 'position', value: 'fixed' },
        { property: 'background-color', value: 'var(--external)' }, { property: 'font-family', value: 'u/**/rl(https://example.com)' },
        { property: 'color', value: '</style><script>' },
      ] },
    ])
    expect(result.editor).toContain('.cm-live-heading-1')
    expect(result.editor).not.toContain('toolbar')
    expect(result.editor).not.toContain('cm-live-heading-2')
    expect(result.editor).not.toContain('position')
    expect(result.editor).not.toContain('var(')
    expect(result.editor).not.toContain('url(')
    expect(result.editor).not.toContain('<')
  })

  it('ignores selectors inherited from Object.prototype', () => {
    const result = mapTyporaThemeRules(['constructor', 'toString', '__proto__'].map(selector => ({ selector, declarations: [{ property: 'color', value: 'red' }] })))
    expect(result).toEqual({ editor: '', export: '' })
  })

  it('maps document styles only within the document and export body', () => {
    const result = mapTyporaThemeRules([{ selector: 'body', declarations: [{ property: 'font-family', value: 'Arial, sans-serif' }] }])
    expect(result.editor).toContain('.document-pane .cm-content,.document-pane .md-preview-block{')
    expect(result.export).toBe('body{font-family:Arial, sans-serif}')
  })

  it('maps Typora table and cell colors to editable tables, previews and exports', () => {
    const result = mapTyporaThemeRules([
      { selector: 'table th, table td', declarations: [{ property: 'border-color', value: '#ccc' }, { property: 'background-color', value: '#fafafa' }] },
      { selector: 'table', declarations: [{ property: 'color', value: '#333' }] },
    ])
    expect(result.editor).toContain('.cm-content :where(.cm-live-table) th,')
    expect(result.editor).toContain('.cm-content :where(.cm-live-table) td,')
    expect(result.editor).toContain('.md-preview-block :where(table) th{')
    expect(result.export).toContain('body :where(table) td{border-color:#ccc;background-color:#fafafa}')
    expect(result.export).toContain('body table{color:#333}')
  })

  it('resolves only safe declared variables and preserves bounded width media conditions', () => {
    const result = mapTyporaThemeRules([
      { selector: ':root', declarations: [{ property: '--text-color', value: '#123456' }, { property: '--unsafe', value: 'url(https://example.com)' }] },
      { selector: 'h1', declarations: [{ property: 'color', value: 'var(--text-color)' }, { property: 'background-color', value: 'var(--unsafe)' }] },
      { selector: 'h2', media: 'only screen and (min-width: 1400px)', declarations: [{ property: 'color', value: '#ccc' }] },
      { selector: 'h3', media: 'screen and (min-width: 99999px)', declarations: [{ property: 'color', value: '#ccc' }] },
    ])
    expect(result.editor).toContain('color:#123456')
    expect(result.editor).not.toContain('background-color')
    expect(result.editor).toContain('@media only screen and (min-width: 1400px){')
    expect(result.export).toContain('@media only screen and (min-width: 1400px){')
    expect(result.editor).not.toContain('cm-live-heading-3')
  })

  it('uses simple variable fallbacks without allowing unsafe declarations', () => {
    const result = mapTyporaThemeRules([
      { selector: ':root', declarations: [{ property: '--ink', value: '#123' }] },
      { selector: 'h1', declarations: [
        { property: 'color', value: 'var(--ink, red)' },
        { property: 'background-color', value: 'var(--missing, #fafafa)' },
        { property: 'border-color', value: 'var(--missing, url(https://example.com))' },
      ] },
    ])
    expect(result.export).toContain('color:#123;background-color:#fafafa')
    expect(result.export).not.toContain('border-color')
    expect(result.export).not.toContain('url(')
  })

  it('rejects unsupported imports, local fonts and external or escaped resources before parsing', () => {
    for (const css of ['@import "theme.css";', '@font-face{font-family:x}', 'p{background:u/**/rl(https://example.com)}', 'p{color: \\72 ed}', 'p{}'.repeat(10001)]) {
      expect(() => compileTyporaTheme(css)).toThrow()
    }
  })
})
