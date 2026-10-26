import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { validateLegacyDiagram } from './legacy-diagram-policy'
import { getMarkdownParser } from './markdown-parser'
import { DEFAULT_MARKDOWN_OPTIONS } from '../../shared/markdown-options'

describe('independent sequence and flow diagrams', () => {
  it('uses real engine tokens and respects the diagram preference', () => {
    const source = '```sequence\nAlice->Bob: Hello\n```\n\n```flow\nst=>start: Start\ne=>end: End\nst->e\n```'
    expect(getMarkdownParser().render(source)).toContain('data-diagram-type="sequence"')
    expect(getMarkdownParser().render(source)).toContain('data-diagram-type="flow"')
    expect(getMarkdownParser({ ...DEFAULT_MARKDOWN_OPTIONS, diagrams: false }).render(source)).not.toContain('data-mermaid')
  })
  it('rejects callbacks, URLs, arbitrary styling and reserved object identifiers before engine parsing', () => {
    for (const source of ['s=>start: Go:>https://example.com', 's=>start: Go:$alert', 'a@>b({"fill":"url(https://evil.test)"})', '__proto__=>start: No']) expect(() => validateLegacyDiagram(source, 'flow')).toThrow()
    expect(() => validateLegacyDiagram('s=>start: Start\ne=>end: End\ns->e', 'flow')).not.toThrow()
    expect(() => validateLegacyDiagram('x'.repeat(20001), 'sequence')).toThrow()
  })
  it('keeps the audited vendor fingerprint and excludes script evaluation and unused fonts', () => {
    const source = readFileSync(new URL('./vendor/sequence/sequence-diagram.js', import.meta.url), 'utf8')
    const notice = readFileSync(new URL('./vendor/sequence/README.md', import.meta.url), 'utf8')
    expect(notice).toContain(createHash('sha256').update(source).digest('hex'))
    expect(source).not.toMatch(/eval\s*\(|new Function|require\(|registerFont|WebFont/)
    expect(source).toContain('export default SequenceDiagram')
    expect(readFileSync(new URL('./vendor/sequence/LICENSE', import.meta.url), 'utf8')).toContain('Redistribution and use in source and binary forms')
  })
})
