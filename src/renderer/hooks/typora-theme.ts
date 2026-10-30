import { allowsThemeCss } from '../../shared/theme-css-policy'

/** A deliberately small, resource-free subset of Typora theme rules. */
export interface ThemeRule { selector: string; declarations: readonly { property: string; value: string }[]; media?: string }
export interface ThemeCss { editor: string; export: string }

const PROPERTIES = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
  'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'border-color', 'border-bottom-color', 'border-left-color',
])

function safeDeclaration(property: string, value: string): boolean {
  return PROPERTIES.has(property) && value.length > 0 && value.length <= 300 && !/[\\@<>;{}]/.test(value) && !/\/\*|\*\//.test(value)
    && !/(?:url|image-set|expression|var)\s*\(/i.test(value) && !/(?:https?|file|data|ftp):/i.test(value)
}

function mediaCondition(value: string): string | null {
  const condition = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (condition === 'screen' || condition === 'print') return condition
  const match = /^(?:(?:only )?screen and )?\((min|max)-width:\s*(\d{3,4})px\)$/.exec(condition)
  if (!match || Number(match[2]) < 320 || Number(match[2]) > 3840) return null
  return condition
}

function replaceVariables(value: string, variables: Map<string, string>): string | null {
  let missing = false
  // Resolve simple CSS fallback values too; complex nested functions remain
  // unsupported and are dropped by the declaration safety check below.
  const result = value.replace(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^()]*?))?\s*\)/g, (_match, key: string, fallback: string | undefined) => {
    const found = variables.get(key)
    if (found === undefined && fallback !== undefined && fallback.trim()) return fallback.trim()
    if (found === undefined) { missing = true; return '' }
    return found
  })
  return missing || /var\s*\(/i.test(result) ? null : result
}

function selectors(raw: string): { editor: string[]; exported: string[] } | null {
  const name = raw.trim().replace(/^#write\s+/, '')
  const root = '.document-pane .cm-content', preview = '.document-pane .md-preview-block'
  if (['html', 'body', '#write'].includes(name)) return { editor: [root, preview], exported: ['body'] }
  const heading = /^h([1-6])$/.exec(name)
  if (heading) return { editor: [`${root} :where(.cm-line).cm-live-heading-${heading[1]}`, `${preview} h${heading[1]}`], exported: [`body h${heading[1]}`] }
  // A rendered table is a widget rather than Markdown text lines. Keep the
  // widget container at zero specificity so the existing custom CSS can win.
  const cell = /^(?:table\s+)?(th|td)$/.exec(name)
  if (cell) return { editor: [`${root} :where(.cm-live-table) ${cell[1]}`, `${preview} :where(table) ${cell[1]}`], exported: [`body :where(table) ${cell[1]}`] }
  if (name === 'table') return { editor: [`${root} :where(.cm-live-table) table`, `${preview} table`], exported: ['body table'] }
  const inline: Record<string, string> = { strong: '.cm-live-strong', em: '.cm-live-emphasis', a: '.cm-live-link', code: '.cm-live-code', blockquote: '.cm-live-quote' }
  if (Object.hasOwn(inline, name)) return { editor: [`${root} ${inline[name]}`, `${preview} ${name}`], exported: [`body ${name}`] }
  // Other selectors are not mapped: their rendered DOM and source ranges differ.
  return null
}

/** Map parsed rules; arbitrary selectors, properties and CSS resource values are discarded. */
export function mapTyporaThemeRules(rules: readonly ThemeRule[]): ThemeCss {
  const editor: string[] = [], exported: string[] = []
  const variables = new Map<string, string>()
  for (const rule of rules) if (!rule.media && rule.selector.trim() === ':root') {
    for (const { property, value } of rule.declarations) {
      if (/^--[a-zA-Z0-9_-]{1,80}$/.test(property) && safeDeclaration('color', value)) variables.set(property, value)
    }
  }
  for (const rule of rules) {
    const media = rule.media ? mediaCondition(rule.media) : null
    if (rule.media && !media) continue
    const declarations = rule.declarations.flatMap(({ property, value }) => {
      const resolved = replaceVariables(value, variables)
      return resolved !== null && safeDeclaration(property.toLowerCase(), resolved) ? [`${property.toLowerCase()}:${resolved}`] : []
    }).join(';')
    if (!declarations) continue
    for (const raw of rule.selector.split(',')) {
      const mapped = selectors(raw)
      if (!mapped) continue
      const edit = `${mapped.editor.join(',')}{${declarations}}`
      const output = `${mapped.exported.join(',')}{${declarations}}`
      editor.push(media ? `@media ${media}{${edit}}` : edit)
      exported.push(media ? `@media ${media}{${output}}` : output)
    }
  }
  return { editor: editor.join('\n'), export: exported.join('\n') }
}

/** Parse a bounded CSS layer without attaching it; unsupported at-rules/resources are rejected. */
export function compileTyporaTheme(source: string): ThemeCss {
  if (source.length > 40_000) throw new Error('主题样式超过大小限制。')
  if (!allowsThemeCss(source)) throw new Error('主题包含不支持的导入、字体或资源。')
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(source)
  const rules: ThemeRule[] = []
  const collect = (items: CSSRuleList, media?: string): void => {
    for (const rule of items) {
      if (rule instanceof CSSStyleRule) {
        const declarations = Array.from(rule.style, property => ({ property, value: rule.style.getPropertyValue(property) }))
        rules.push({ selector: rule.selectorText, declarations, media })
      } else if (!media && rule instanceof CSSMediaRule && mediaCondition(rule.conditionText)) collect(rule.cssRules, rule.conditionText)
    }
  }
  collect(sheet.cssRules)
  return mapTyporaThemeRules(rules)
}
