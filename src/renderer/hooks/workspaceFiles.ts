import type { FileEntry, Result } from '../../shared/contracts'

export const WORKSPACE_INDEX_LIMITS = { directories: 200, files: 5000, entries: 20000 }
export interface WorkspaceFileIndex {
  files: FileEntry[]
  directories: number
  entries: number
  isTruncated: boolean
  errors: string[]
  isCancelled: boolean
}

export function filePathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

type ReadDirectory = (path: string) => Promise<Result<FileEntry[]>>

export async function indexWorkspaceFiles(
  readDirectory: ReadDirectory,
  root: string,
  options: {
    isCancelled?: () => boolean
    onProgress?: (index: WorkspaceFileIndex) => void
    limits?: typeof WORKSPACE_INDEX_LIMITS
  } = {},
): Promise<WorkspaceFileIndex> {
  const limits = options.limits ?? WORKSPACE_INDEX_LIMITS
  const queue = [root]
  const seen = new Set<string>()
  const files = new Map<string, FileEntry>()
  const index: WorkspaceFileIndex = { files: [], directories: 0, entries: 0, isTruncated: false, errors: [], isCancelled: false }
  const publish = () => {
    index.files = [...files.values()]
    options.onProgress?.({ ...index, files: [...index.files], errors: [...index.errors] })
  }
  while (queue.length) {
    if (options.isCancelled?.()) { index.isCancelled = true; break }
    const directory = queue.shift()!
    const key = filePathKey(directory)
    if (seen.has(key)) continue
    if (index.directories >= limits.directories || files.size >= limits.files || index.entries >= limits.entries) {
      index.isTruncated = true; break
    }
    seen.add(key)
    index.directories++
    let result: Result<FileEntry[]>
    try { result = await readDirectory(directory) }
    catch (error) {
      index.errors.push(`${directory}：${error instanceof Error ? error.message : '读取失败'}`)
      continue
    }
    if (options.isCancelled?.()) { index.isCancelled = true; break }
    if (!result.ok) { index.errors.push(`${directory}：${result.error.message}`); continue }
    for (let position = 0; position < result.data.length; position++) {
      const entry = result.data[position]
      if (index.entries >= limits.entries || files.size >= limits.files) {
        index.isTruncated = true; break
      }
      index.entries++
      const entryKey = filePathKey(entry.path)
      if (entry.kind === 'directory') {
        if (!seen.has(entryKey)) queue.push(entry.path)
      } else if (!files.has(entryKey)) files.set(entryKey, entry)
    }
    if (index.directories % 8 === 0) publish()
    if (index.isTruncated) break
  }
  index.files = [...files.values()]
  return index
}
