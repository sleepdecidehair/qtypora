export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md', '.markdown', '.mdown', '.mkd', '.qmd', '.txt',
])

export function isMarkdownExtension(extension: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extension.toLowerCase())
}

export function isMarkdownFileName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && isMarkdownExtension(name.slice(dot))
}
