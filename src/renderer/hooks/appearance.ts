import type { Preferences } from '../../shared/contracts'

function scopedCss(source: string, roots: string[]): string {
  if (!source.trim()) return ''
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(source.slice(0, 40000))
  const rules: string[] = []
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSStyleRule)) continue
    const selectors = rule.selectorText.split(',').map(selector => selector.trim())
    if (selectors.some(selector => /:has\(|[{}@\\<>]/i.test(selector))) continue
    const declarations: string[] = []
    for (const property of rule.style) {
      const value = rule.style.getPropertyValue(property)
      if (/url\s*\(|expression\s*\(|[\\@<>]/i.test(value) || /^(?:position|z-index|content|behavior|-moz-binding)$/i.test(property)) continue
      declarations.push(`${property}:${value}${rule.style.getPropertyPriority(property) ? '!important' : ''}`)
    }
    const scope = selectors.flatMap(selector => roots.map(root => {
      const suffix = selector.replace(/^(?:body|html|#write)(?=\s|$)/, '').trim()
      return suffix ? `${root} ${suffix}` : root
    }))
    if (declarations.length) rules.push(`${scope.join(',')}{${declarations.join(';')}}`)
  }
  return rules.join('\n')
}

/** User CSS applies only to article contents and cannot load external resources. */
export function articleCss(source: string): string { return scopedCss(source, ['.document-pane .cm-content', '.document-pane .md-preview-block']) }

export function exportTheme(preferences: Preferences, systemDark: boolean): 'light' | 'dark' {
  return preferences.export.theme === 'current' ? preferences.theme === 'dark' || (preferences.theme === 'system' && systemDark) ? 'dark' : 'light' : preferences.export.theme
}

export function exportAppearance(preferences: Preferences, systemDark: boolean): string {
  const mode = exportTheme(preferences, systemDark)
  const colors = mode === 'dark' ? preferences.darkTheme === 'charcoal' ? ['#171717', '#e0e0e0'] : ['#1e232b', '#dbe2eb']
    : preferences.lightTheme === 'sepia' ? ['#fbf6e9', '#463c2e'] : preferences.lightTheme === 'blue' ? ['#f7fbff', '#293d52'] : ['#ffffff', '#262b32']
  const style = document.createElement('span').style
  style.fontSize = `${preferences.fontSize}px`
  style.lineHeight = String(preferences.lineHeight)
  if (preferences.fontFamily) style.fontFamily = preferences.fontFamily
  style.color = colors[1]; style.backgroundColor = colors[0]
  return `body{${style.cssText}}${mode === 'dark' ? 'pre,code{background:#282f39}th,td{border-color:#576170}a{color:#8bbceb}' : ''}\n${scopedCss(preferences.customCss, ['body'])}`
}
