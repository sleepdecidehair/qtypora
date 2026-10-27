import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { assertNoActiveFileOperations, assertNoOtherActiveFileOperations, isPathWithin, relocatedPath, withActiveFileOperation, withWorkspaceStructure } from './workspace-lock'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

describe('workspace structure serialization', () => {
  it('does not start a new image/export operation after a move has passed its active check', async () => {
    const entered = barrier(), finishMove = barrier(), started = barrier()
    let operationStarted = false
    const moving = withWorkspaceStructure(async () => { assertNoActiveFileOperations(); entered.release(); await finishMove.promise })
    await entered.promise
    const work = withActiveFileOperation(async () => { operationStarted = true; started.release() })
    await Promise.resolve()
    expect(operationStarted).toBe(false)
    finishMove.release()
    await moving
    await started.promise
    await work
  })

  it('rejects a move while a native dialog is pending without waiting for that dialog', async () => {
    const entered = barrier(), closeDialog = barrier()
    const work = withActiveFileOperation(async () => { entered.release(); await closeDialog.promise })
    await entered.promise
    try { await expect(withWorkspaceStructure(async () => assertNoActiveFileOperations())).rejects.toMatchObject({ code: 'CONFLICT' }) }
    finally { closeDialog.release(); await work }
    await expect(withWorkspaceStructure(async () => assertNoActiveFileOperations())).resolves.toBeUndefined()
  })

  it('allows a trash reservation alone but rejects it when another file operation is active', async () => {
    const entered = barrier(), release = barrier()
    const other = withActiveFileOperation(async () => { entered.release(); await release.promise })
    await entered.promise
    try {
      await withActiveFileOperation(async () => {
        await expect(withWorkspaceStructure(async () => assertNoOtherActiveFileOperations())).rejects.toMatchObject({ code: 'CONFLICT' })
      })
    } finally { release.release(); await other }
    await withActiveFileOperation(() => withWorkspaceStructure(async () => assertNoOtherActiveFileOperations()))
  })

  it('handles segment boundaries and drive/root paths without prefix collisions', () => {
    const root = path.parse(path.resolve('a')).root
    const base = path.join(root, 'a', 'b'), destination = path.join(root, 'destination')
    expect(isPathWithin(path.join(base, 'file'), base)).toBe(true)
    expect(isPathWithin(path.join(root, 'a', 'bad', 'file'), base)).toBe(false)
    expect(isPathWithin(path.join(root, 'a'), root)).toBe(true)
    expect(isPathWithin(path.join(root, 'A', 'b', 'c.txt'), base)).toBe(false)
    expect(relocatedPath(base, destination, path.join(base, 'c.txt'))).toBe(path.join(destination, 'c.txt'))
  })
})
