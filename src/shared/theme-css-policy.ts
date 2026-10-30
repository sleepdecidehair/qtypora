/** Preliminary resource gate; the renderer must also apply the strict rule mapper. */
export function allowsThemeCss(source: string): boolean {
  // Skip strings and comments without letting escaped identifiers disguise url/@import.
  let plain = '', quote = ''
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      if (char === '\\') { if (++index >= source.length) return false }
      else if (char === quote) { quote = ''; plain += '""' }
      else if (char === '\n' || char === '\r') return false
    } else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      if (end < 0) return false
      index = end + 1
    } else if (char === '"' || char === "'") quote = char
    else plain += char
  }
  if (quote) return false
  return !/\\|@(?!media\b)|(?:url|(?:-webkit-)?image-set)\s*\(|(?:https?|file|data|ftp):/i.test(plain)
}
