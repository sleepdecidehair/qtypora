export interface WorkspaceOptions {
  view: 'tree' | 'list'
  sort: 'natural' | 'name' | 'modified' | 'created'
  descending: boolean
  foldersFirst: boolean
  showHidden: boolean
  showAllFiles: boolean
  filter: string
  pinnedFolders: string[]
}

export const DEFAULT_WORKSPACE_OPTIONS: WorkspaceOptions = {
  view: 'tree', sort: 'natural', descending: false, foldersFirst: true,
  showHidden: false, showAllFiles: false, filter: '', pinnedFolders: [],
}

export function normalizeWorkspaceOptions(input?: unknown): WorkspaceOptions {
  if (input === undefined) return { ...DEFAULT_WORKSPACE_OPTIONS, pinnedFolders: [] }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('文件浏览设置无效。')
  const value = input as Record<string, unknown>
  const result = { ...DEFAULT_WORKSPACE_OPTIONS, pinnedFolders: [] as string[] }
  for (const key of ['descending', 'foldersFirst', 'showHidden', 'showAllFiles'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'boolean') throw new Error(`文件浏览设置 ${key} 必须是布尔值。`)
    result[key] = value[key]
  }
  if (value.view !== undefined) {
    if (value.view !== 'tree' && value.view !== 'list') throw new Error('文件视图无效。')
    result.view = value.view
  }
  if (value.sort !== undefined) {
    if (typeof value.sort !== 'string' || !['natural', 'name', 'modified', 'created'].includes(value.sort)) throw new Error('文件排序方式无效。')
    result.sort = value.sort as WorkspaceOptions['sort']
  }
  if (value.filter !== undefined) {
    if (typeof value.filter !== 'string' || value.filter.length > 256 || /[\u0000-\u001f]/.test(value.filter)) throw new Error('文件筛选最长 256 字符，不能含控制字符。')
    result.filter = value.filter
  }
  if (value.pinnedFolders !== undefined) {
    if (!Array.isArray(value.pinnedFolders) || value.pinnedFolders.length > 20 || value.pinnedFolders.some(path => typeof path !== 'string' || path.length > 4096 || /[\u0000-\u001f]/.test(path) || !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path))) throw new Error('固定目录必须是最多 20 个绝对路径。')
    result.pinnedFolders = [...new Set(value.pinnedFolders as string[])]
  }
  return result
}

// A wildcard scan avoids converting repeated '*' into a backtracking regular expression.
export function wildcardMatches(name: string, pattern: string): boolean {
  const text = name.toLocaleLowerCase()
  const glob = pattern.toLocaleLowerCase()
  let position = 0
  let token = 0
  let star = -1
  let retry = 0
  while (position < text.length) {
    if (glob[token] === '?' || glob[token] === text[position]) { position++; token++ }
    else if (glob[token] === '*') { star = token++; retry = position }
    else if (star >= 0) { token = star + 1; position = ++retry }
    else return false
  }
  while (glob[token] === '*') token++
  return token === glob.length
}

export function matchesFileFilter(name: string, filter: string): boolean {
  const terms = filter.split(',').map(term => term.trim()).filter(Boolean)
  const included = terms.filter(term => !term.startsWith('!'))
  const excluded = terms.filter(term => term.startsWith('!')).map(term => term.slice(1))
  const matches = (term: string) => wildcardMatches(name, /[*?]/.test(term) ? term : `*${term}*`)
  return (!included.length || included.some(matches)) && !excluded.some(matches)
}

export function compareWorkspaceEntries(
  first: { name: string; kind: 'file' | 'directory'; modifiedAt: number; createdAt?: number },
  second: { name: string; kind: 'file' | 'directory'; modifiedAt: number; createdAt?: number },
  options: WorkspaceOptions,
): number {
  if (options.foldersFirst && first.kind !== second.kind) return first.kind === 'directory' ? -1 : 1
  const byName = first.name.localeCompare(second.name, 'zh-CN', { numeric: options.sort === 'natural' })
  const sorted = options.sort === 'modified' ? first.modifiedAt - second.modifiedAt
    : options.sort === 'created' ? (first.createdAt ?? first.modifiedAt) - (second.createdAt ?? second.modifiedAt) : byName
  return (sorted || byName) * (options.descending ? -1 : 1)
}
