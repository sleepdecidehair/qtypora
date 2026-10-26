export interface MarkdownOptions {
  strictMode: boolean
  frontMatter: boolean
  toc: boolean
  alerts: boolean
  highlight: boolean
  subscript: boolean
  superscript: boolean
  footnotes: boolean
  emoji: boolean
  inlineMath: boolean
  mathNumbering: boolean
  diagrams: boolean
  smartPunctuation: boolean
  softBreaks: boolean
  autoPairBrackets: boolean
  autoPairMarkdown: boolean
  codeLineNumbers: boolean
  codeWrapLines: boolean
  codeIndentSize: number
  defaultCodeLanguage: string
}

export const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptions = {
  strictMode: false,
  frontMatter: true, toc: true, alerts: false, highlight: true,
  subscript: true, superscript: true, footnotes: true, emoji: true,
  inlineMath: true, mathNumbering: false, diagrams: true, smartPunctuation: false, softBreaks: false,
  autoPairBrackets: true, autoPairMarkdown: true, codeLineNumbers: false,
  codeWrapLines: true, codeIndentSize: 2, defaultCodeLanguage: '',
}

/** Keep saved extension preferences intact while the CommonMark preset is active. */
export function effectiveMarkdownOptions(options: MarkdownOptions): MarkdownOptions {
  return options.strictMode ? { ...options, frontMatter: false, toc: false, alerts: false, highlight: false,
    subscript: false, superscript: false, footnotes: false, emoji: false, inlineMath: false, mathNumbering: false,
    diagrams: false, smartPunctuation: false, softBreaks: false } : options
}

export function normalizeMarkdownOptions(input: unknown): MarkdownOptions {
  if (input === undefined) return { ...DEFAULT_MARKDOWN_OPTIONS }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Markdown 设置无效。')
  const source = input as Record<string, unknown>
  const options = { ...DEFAULT_MARKDOWN_OPTIONS }
  for (const name of Object.keys(DEFAULT_MARKDOWN_OPTIONS) as (keyof MarkdownOptions)[]) {
    const value = source[name]
    if (value === undefined) continue
    if (name === 'codeIndentSize') {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 8) throw new Error('代码缩进宽度必须为 1 到 8。')
      options.codeIndentSize = value as number
    } else if (name === 'defaultCodeLanguage') {
      if (typeof value !== 'string' || value.length > 40 || !/^[\w+#.-]*$/.test(value)) throw new Error('默认代码语言无效。')
      options.defaultCodeLanguage = value
    } else {
      if (typeof value !== 'boolean') throw new Error(`Markdown 设置 ${name} 必须为布尔值。`)
      options[name] = value
    }
  }
  return options
}
