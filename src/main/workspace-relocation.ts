import type { DocumentSession } from './documents'
import { DesktopError } from './errors'
import type { LocalStore } from './preferences'
import type { ResourceRegistry } from './resources'
import { canonicalPath } from './files'
import { isPathWithin, isPossiblyWithin, relocatedPath } from './workspace-lock'

/** Must run under the workspace structure lock before creating a destination. */
export function assertDestinationUnoccupied(destination: string, sessions: readonly DocumentSession[], store: LocalStore, resources: ResourceRegistry): void {
  const occupied = sessions.some(session =>
    (session.workspace && isPossiblyWithin(session.workspace, destination)) ||
    session.records().some(record => record.path && isPossiblyWithin(record.path, destination))) ||
    [...store.drafts.values()].some(draft => draft.path && isPossiblyWithin(draft.path, destination)) ||
    resources.hasPathsWithin(destination)
  if (occupied) throw new DesktopError('CONFLICT', '目标路径被打开的文档、工作区或恢复草稿占用，请先处理后重试。')
}

/** Reject aliases that might refer to the source but cannot be relocated without guessing. */
export async function assertSourcePathsUnambiguous(source: string, sessions: readonly DocumentSession[], store: LocalStore, resources: ResourceRegistry): Promise<void> {
  const paths = [
    ...sessions.flatMap(session => [session.workspace, ...session.allowedRoots, ...session.records().map(record => record.path)]),
    ...[...store.drafts.values()].map(draft => draft.path),
    ...resources.registeredPaths(),
  ]
  for (const candidate of paths) {
    if (!candidate || isPathWithin(candidate, source) || !isPossiblyWithin(candidate, source)) continue
    let canonical: string
    try { canonical = await canonicalPath(candidate) }
    catch { throw new DesktopError('CONFLICT', '路径大小写存在无法确认的歧义，请先处理相关文档或草稿。') }
    if (isPathWithin(canonical, source)) throw new DesktopError('CONFLICT', '路径大小写存在无法确认的歧义，请先处理相关文档或草稿。')
  }
}

/** Caller holds the structure and affected-document locks. All visible paths change before I/O. */
export async function relocateWorkspaceState(source: string, destination: string | null, sessions: readonly DocumentSession[], store: LocalStore, resources: ResourceRegistry): Promise<void> {
  if (destination) resources.relocatePaths(source, destination)
  const persist = sessions.map(session => session.preparePathUpdates(source, destination))
  const failures: unknown[] = []
  for (const write of persist) {
    try { await write() } catch (error) { failures.push(error) }
  }
  if (destination) for (const draft of [...store.drafts.values()]) {
    if (!draft.path || !isPathWithin(draft.path, source)) continue
    try { await store.writeDraft({ ...draft, path: relocatedPath(source, destination, draft.path) }) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new DesktopError('IO_ERROR', '文件位置已更新，但部分草稿写入失败；请保留窗口并另存文档。')
}
