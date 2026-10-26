import type { MathExpression } from './markdown-features'
import type { MarkdownOptions } from '../../shared/markdown-options'

export interface LiveOptions {
  markdownOptions?: MarkdownOptions
  mathExpressions?: MathExpression[]
  mathKey?: string
  theme: 'light' | 'dark'
  focusMode: boolean
  readOnly: boolean
  resolveResource: (source: string) => Promise<string>
  onLinkOpen: (target: string) => void
}

export interface LiveBlock {
  from: number
  to: number
  firstLine: number
  lastLine: number
  source: string
  html: string
  kind: 'table' | 'math' | 'mermaid' | 'image' | 'html' | 'rule' | 'front-matter' | 'toc' | 'alert' | 'footnote'
}
