import { describe, expect, it } from 'vitest'
import { renderMathML } from './mathjax-runtime'

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
  it('rejects oversized formulas before invoking the TeX parser', () => {
    expect(() => renderMathML('x'.repeat(8193), true)).toThrow('8192')
  })
})
