import { describe, expect, it } from 'vitest'
import { renderMathML, renderMathSequence } from './mathjax-runtime'

describe('offline MathJax conversion', () => {
  it('converts TeX fractions and exponents into native MathML', () => {
    const output = renderMathML('\\frac{a}{b} + x^2', true)
    expect(output).toContain('<math')
    expect(output).toContain('<mfrac')
    expect(output).toContain('<msup')
    expect(output).toContain('display="block"')
    expect(output).not.toMatch(/\b(?:src|href)=/)
  })
  it('converts AMS math without loading fonts or browser components', () => {
    expect(renderMathML('\\begin{matrix}a & b \\\\ c & d\\end{matrix}', false)).toContain('<mtable')
  })
  it('renders chemistry and physics packages offline', () => {
    const chemistry = renderMathML('\\ce{H2O + CO2 -> H2CO3}', true)
    expect(chemistry).toContain('<msub')
    expect(chemistry).not.toContain('<merror')
    const physics = renderMathML('\\dv{f}{x} + \\ket{\\psi}', true)
    expect(physics).toContain('<mfrac')
    expect(physics).not.toContain('<merror')
  })
  it('rejects oversized formulas before invoking the TeX parser', () => {
    expect(() => renderMathML('x'.repeat(8193), true)).toThrow('8192')
  })
  it('bounds expanded MathML and caches failures so every live block does not repeat expensive conversion', () => {
    const expressions = Array.from({ length: 30 }, (_, line) => ({ source: 'x+'.repeat(2000) + line, display: true, line }))
    let failure: unknown
    try { renderMathSequence(expressions, false) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('2 MB')
    let repeated: unknown
    try { renderMathSequence(expressions, false) } catch (error) { repeated = error }
    expect(repeated).toBe(failure)
    expect(renderMathSequence([{ source: 'x=1', display: true, line: 1 }], true)[0]).toContain('>1<')
  })
})


describe('document equation numbering and references', () => {
  it('resolves forward references and numbers display formulas in document order', () => {
    const formulas = [
      { source: '\\eqref{energy}', display: false, line: 1 },
      { source: 'x = 1', display: true, line: 3 },
      { source: 'E=mc^2 \\label{energy}', display: true, line: 7 },
    ]
    const result = renderMathSequence(formulas, true)
    expect(result[0]).not.toContain('???')
    expect(result[0]).toContain('>(2)<')
    expect(result[1]).toContain('>1<')
    expect(result[2]).toContain('id="mjx-eqn:energy"')
    const changed = renderMathSequence([formulas[0], formulas[2]], true)
    expect(changed[0]).toContain('>(1)<')
    expect(changed[0]).not.toContain('>(2)<')
  })
  it('isolates user macros and labels across documents, including after conversion failures', () => {
    const first = renderMathSequence([
      { source: '\\newcommand{\\mytest}{42} \\mytest \\label{private}', display: true, line: 1 },
    ], true)
    expect(first[0]).toContain('42')
    const second = renderMathSequence([{ source: '\\mytest + \\ref{private}', display: false, line: 1 }], false)
    expect(second[0]).not.toContain('42')
    expect(second[0]).toContain('???')
    expect(() => renderMathSequence([{ source: 'x'.repeat(8193), display: true, line: 1 }], true)).toThrow()
    expect(renderMathSequence([{ source: 'y=2', display: true, line: 1 }], true)[0]).toContain('>1<')
  })
  it('keeps duplicate label errors visible and bounds document work', () => {
    const result = renderMathSequence([
      { source: 'a\\label{same}', display: true, line: 1 },
      { source: 'b\\label{same}', display: true, line: 3 },
      { source: '\\eqref{same}', display: false, line: 5 },
    ], true)
    expect(result[1]).toContain('<merror')
    expect(renderMathML('\\newcommand{\\loop}{\\loop}\\loop', true)).toContain('<merror')
    expect(() => renderMathSequence(Array.from({ length: 501 }, () => ({ source: 'x', display: true, line: 1 })), true)).toThrow('上限')
  })
})
