import { describe, expect, it } from 'vitest'
import { validateDiagramStyles } from './diagram-style'

describe('Mermaid CSS before attached rendering', () => {
  it('accepts standard node style and classDef colors', () => {
    const source = 'graph LR\nA[开始]-->B[结束]\nclassDef done fill:#d6f2df,stroke:#3c7d68,color:#244f42;\nclass B done;\nstyle A fill:#fff4cc,stroke:#ae8a22;'
    expect(() => validateDiagramStyles(source)).not.toThrow()
  })
  it('rejects resource or executable style values before rendering', () => {
    for (const value of ['url(http://127.0.0.1:9/blocked.svg)', 'url(#local)', 'expression(alert(1))', 'u\\72l(http://example.com/x)', 'data:image/svg+xml,test', 'javascript:alert(1)', '@import "x"']) {
      expect(() => validateDiagramStyles(`graph LR; A-->B; style A fill:${value};`)).toThrow()
    }
  })
  it('validates linkStyle and rejects unsupported CSS properties', () => {
    expect(() => validateDiagramStyles('graph LR\nA-->B\nlinkStyle 0 stroke:#3c7d68,stroke-width:2px;')).not.toThrow()
    expect(() => validateDiagramStyles('graph LR\nA-->B\nclassDef x background-image:none;')).toThrow()
  })
  it('rejects stylesheet escapes and CSS comments before rendering', () => {
    for (const value of ['red}html{color:red', 'red/*hidden*/', 'red*/']) {
      expect(() => validateDiagramStyles(`graph LR\nA-->B\nclassDef x fill:${value};`)).toThrow()
    }
  })
  it('handles parenthesized colors and escaped dash-array commas', () => {
    expect(() => validateDiagramStyles('graph LR\nA-->B\nstyle A fill:rgb(250,240,200),stroke-dasharray:5\\,5;')).not.toThrow()
  })
})
