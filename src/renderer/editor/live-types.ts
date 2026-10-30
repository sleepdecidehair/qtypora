import type { MathExpression } from './markdown-features'
import type { MarkdownOptions } from '../../shared/markdown-options'

export interface LiveOptions {
  locale?: import('../../shared/i18n').AppLocale
  markdownOptions?: MarkdownOptions
  mathExpressions?: MathExpression[]
  mathKey?: string
  theme: 'light' | 'dark'
  focusMode: boolean
  readOnly: boolean
  resolveResource: (source: string) => Promise<string>
  onLinkOpen: (target: string) => void
  onError?: (message: string) => void
  onTableImagePaste?: (view: import('@codemirror/view').EditorView, files: File[], range: { from: number; to: number }, isCurrent: () => boolean, virtualCell?: { tableFrom: number; tableTo: number; row: number; column: number; prefix: string }) => void
  onTableHtmlPaste?: (view: import('@codemirror/view').EditorView, html: string, target: import('./live-table').LiveTableImageTarget) => void
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
