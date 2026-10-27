import { serialized } from './files'
import path from 'node:path'
import { DesktopError } from './errors'

let activeFileOperations = 0

/** Serializes filesystem structure changes with registration of open document paths. */
export function withWorkspaceStructure<T>(operation: () => Promise<T>): Promise<T> {
  return serialized('workspace-structure', operation)
}

/** Reserve an in-flight file operation without holding a lock during a native dialog. */
export async function withActiveFileOperation<T>(operation: () => Promise<T>): Promise<T> {
  await withWorkspaceStructure(async () => { activeFileOperations++ })
  try { return await operation() } finally { activeFileOperations-- }
}

export function assertNoActiveFileOperations(): void {
  if (activeFileOperations) throw new DesktopError('CONFLICT', '有其他文件操作正在进行，请完成或取消后重试。')
}

/** Only the caller's own non-locking file-operation reservation may remain. */
export function assertNoOtherActiveFileOperations(): void {
  if (activeFileOperations !== 1) throw new DesktopError('CONFLICT', '有其他文件操作正在进行，请完成或取消后重试。')
}

export function isPathWithin(candidate: string, root: string): boolean {
  const value = path.resolve(candidate), prefix = path.resolve(root)
  return value === prefix || value.startsWith(prefix.endsWith(path.sep) ? prefix : prefix + path.sep)
}

/** For rejecting ambiguous destinations, case-folding may safely err on the side of caution. */
export function isPossiblyWithin(candidate: string, root: string): boolean {
  const value = path.resolve(candidate).normalize('NFD').toLowerCase(), prefix = path.resolve(root).normalize('NFD').toLowerCase()
  return value === prefix || value.startsWith(prefix.endsWith(path.sep) ? prefix : prefix + path.sep)
}

export function relocatedPath(source: string, destination: string, candidate: string): string {
  return path.join(destination, candidate.slice(source.length).replace(/^[\\/]+/, ''))
}
