import * as fs from 'node:fs/promises'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { IMAGE_MIME } from './files'

const parser = new MarkdownIt({ html: true })

function imageSources(tokens: Token[]): string[] {
  const sources: string[] = []
  for (const token of tokens) {
    if (token.type === 'image') {
      const source = token.attrGet('src')
      if (source) sources.push(source)
    }
    if (token.type === 'html_inline' || token.type === 'html_block') {
      for (const match of token.content.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
        const source = match[1] ?? match[2] ?? match[3]
        if (source) sources.push(source)
      }
    }
    if (token.children) sources.push(...imageSources(token.children))
  }
  return sources
}

export function markdownImageSources(content: string): string[] {
  const markdown = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  return [...new Set(imageSources(parser.parse(markdown, {})))]
}

async function isFile(filePath: string): Promise<boolean> {
  try { return (await fs.stat(filePath)).isFile() }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false
    throw error
  }
}

export async function missingImagesAfterSaveAs(content: string, originalPath: string | null, destination: string): Promise<string[]> {
  if (!originalPath || path.dirname(originalPath).toLowerCase() === path.dirname(destination).toLowerCase()) return []
  const sources = markdownImageSources(content)
  const missing: string[] = []
  for (const source of sources) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(source) || path.isAbsolute(source) || source.startsWith('//')) continue
    let decoded: string
    try { decoded = decodeURIComponent(source) } catch { continue }
    if (!IMAGE_MIME[path.extname(decoded).toLowerCase()]) continue
    const oldFile = path.resolve(path.dirname(originalPath), decoded)
    const nextFile = path.resolve(path.dirname(destination), decoded)
    if (await isFile(oldFile) && !await isFile(nextFile)) missing.push(source)
  }
  return missing
}
