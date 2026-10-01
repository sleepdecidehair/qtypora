const DIAGRAM_STYLE_PROPERTIES = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'text-anchor', 'dominant-baseline', 'color', 'background-color', 'opacity', 'text-align', 'white-space', 'line-height', 'margin', 'padding', 'border', 'border-radius', 'max-width', 'pointer-events', 'display', '--mermaid-font-family'])

function isSafeStyleValue(value: string): boolean {
  return !/url\s*\(|expression\s*\(|(?:javascript|https?|ftp|file|data|blob):|@|[<>{}\\]|\/\*|\*\//i.test(value)
}

export function filterDiagramStyle(style: CSSStyleDeclaration): string {
  const declarations: string[] = []
  for (const property of style) {
    const value = style.getPropertyValue(property)
    if (!DIAGRAM_STYLE_PROPERTIES.has(property) || !isSafeStyleValue(value)) continue
    declarations.push(`${property}:${value}${style.getPropertyPriority(property) ? '!important' : ''}`)
  }
  return declarations.join(';')
}

function splitStyleDeclarations(source: string): string[] {
  const result: string[] = []
  let current = ''
  let depth = 0
  let quote = ''
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '\\' && source[index + 1] === ',') { current += ','; index++; continue }
    if (quote) {
      current += character
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") quote = character
    if (character === '(') depth++
    if (character === ')') depth--
    if (character === ',' && depth === 0) { result.push(current); current = '' }
    else current += character
  }
  if (current.trim()) result.push(current)
  return result
}

// Validate before Mermaid creates attached DOM, so rejected CSS never triggers resource loads.
export function validateDiagramStyles(source: string): void {
  const commands = source.matchAll(/(?:^|[\n;])\s*(?:style|classDef|linkStyle)\s+[^\s]+[ \t]+([^\r\n;]*)/gi)
  for (const command of commands) {
    const declarations = splitStyleDeclarations(command[1])
    if (!declarations.length) throw new Error('图表样式声明无效')
    for (const declaration of declarations) {
      const separator = declaration.indexOf(':')
      const property = declaration.slice(0, separator).trim().toLowerCase()
      const value = declaration.slice(separator + 1).trim()
      if (separator <= 0 || !DIAGRAM_STYLE_PROPERTIES.has(property) || !value || !isSafeStyleValue(value)) {
        throw new Error('图表样式包含不支持的属性或外部资源，请仅使用本地绘图和排版属性')
      }
    }
  }
}
