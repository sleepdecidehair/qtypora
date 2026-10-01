import type { FileEntry } from '../../shared/contracts'
import { filePathKey } from './workspaceFiles'

export interface QuickOpenDocument { id: string; name: string; path: string | null; isDirty: boolean }
export interface QuickOpenItem {
  key: string; name: string; path: string; id: string | null
  scope: 'open' | 'recent' | 'workspace'; isDirty: boolean
}

export function quickOpenItems(documents: QuickOpenDocument[], recentFiles: string[], files: FileEntry[]): QuickOpenItem[] {
  const seen = new Set<string>()
  const items: QuickOpenItem[] = []
  for (const document of documents) {
    const key = document.path ? filePathKey(document.path) : `untitled:${document.id}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ key: document.id, name: document.name, path: document.path ?? '未保存文档', id: document.id, scope: 'open', isDirty: document.isDirty })
  }
  for (const path of recentFiles) {
    const key = filePathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ key, name: path.split(/[\\/]/).pop() ?? path, path, id: null, scope: 'recent', isDirty: false })
  }
  for (const file of files) {
    const key = filePathKey(file.path)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ key, name: file.name, path: file.path, id: null, scope: 'workspace', isDirty: false })
  }
  return items
}

function matchScore(text: string, query: string): number {
  if (text === query) return 1000
  if (text.startsWith(query)) return 800
  const direct = text.indexOf(query)
  if (direct >= 0) return 600 - Math.min(direct, 100)
  let cursor = 0
  let start = -1
  for (const character of query) {
    const index = text.indexOf(character, cursor)
    if (index < 0) return -1
    if (start < 0) start = index
    cursor = index + 1
  }
  return 300 - Math.min(cursor - start - query.length, 200)
}

export function filterQuickOpenItems(items: QuickOpenItem[], query: string): QuickOpenItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return items
  return items.map((item, index) => {
    const name = item.name.toLowerCase()
    const path = item.path.toLowerCase().replace(/\\/g, '/')
    let score = 0
    for (const term of terms) {
      const matched = Math.max(matchScore(name, term), matchScore(path, term.replace(/\\/g, '/')) - 150)
      if (matched < 0) return null
      score += matched
    }
    return { item, score, index }
  }).filter((match): match is { item: QuickOpenItem; score: number; index: number } => match !== null)
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map(match => match.item)
}
