export interface LiveOptions {
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
  kind: 'table' | 'math' | 'mermaid' | 'image' | 'html' | 'rule'
}
