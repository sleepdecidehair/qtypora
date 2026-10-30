/** True when inserting or cutting here would split a Markdown backslash escape. */
export function splitsMarkdownEscape(source: string, position: number): boolean {
  if (position <= 0 || position >= source.length) return false
  const code = source.charCodeAt(position)
  if (!((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126))) return false
  let slashes = 0
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index--) slashes++
  return slashes % 2 === 1
}

/** Conservatively reject a split entity or Unicode grapheme within one source line. */
export function unsafeMarkdownCharacterBoundary(source: string, position: number): boolean {
  if (position < 0 || position > source.length) return true
  const start = source.lastIndexOf('\n', position - 1) + 1
  const endAt = source.indexOf('\n', position), end = endAt === -1 ? source.length : endAt
  const line = source.slice(start, end), offset = position - start
  if (offset === 0 || offset === line.length) return false
  if (line.length > 100000) return true
  let boundary = false
  for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)) {
    if (segment.index >= offset) { boundary = segment.index === offset; break }
  }
  if (!boundary) return true
  for (const match of line.matchAll(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi)) {
    if (offset <= match.index || offset >= match.index + match[0].length) continue
    let slashes = 0
    for (let index = match.index - 1; index >= 0 && line[index] === '\\'; index--) slashes++
    if (slashes % 2 === 0) return true
  }
  return false
}
