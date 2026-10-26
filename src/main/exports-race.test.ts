import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }))
vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: { showSaveDialog: vi.fn() }, session: {} }))
vi.mock('./custom-export', () => ({ runCustomExport: vi.fn(async () => Buffer.from('# Exported custom content')) }))
import { dialog, type BrowserWindow } from 'electron'
import { DEFAULT_EXPORT_OPTIONS, type ExportFormat } from '../shared/export-options'
import { DocumentSession } from './documents'
import { LocalStore } from './preferences'
import { ResourceRegistry } from './resources'
import * as files from './files'
import { exportDocument } from './exports'

let directory: string
const sessions: DocumentSession[] = []
beforeEach(async () => { directory = await files.canonicalPath(await fs.mkdtemp(path.join(os.tmpdir(), 'qtypora-export-race-'))) })
afterEach(async () => {
  sessions.splice(0).forEach(session => session.dispose())
  vi.restoreAllMocks(); vi.clearAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

function signal() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

describe('exports sharing a save destination', () => {
  for (const [kind, extension] of [['markdown', 'md'], ['custom', 'txt']] as const) {
    it(`${kind} waits for another window's Save As and refuses overwriting its new source`, async () => {
      const destination = path.join(directory, `shared.${extension}`)
      const store = new LocalStore(path.join(directory, 'user'))
      await store.load()
      const createSession = () => {
        const session = new DocumentSession(store, { chooseSave: async () => destination, confirmClose: async () => 'cancel' }, () => undefined)
        sessions.push(session)
        return session
      }
      const savingWindow = createSession(), exportingWindow = createSession()
      const savingDocument = savingWindow.create(), exportingDocument = exportingWindow.create('# Exported Markdown content')
      const beforeRename = signal(), finishSave = signal(), exportQueued = signal()
      const rename = fs.rename
      let held = false
      vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
        if (target === destination && !held) {
          held = true
          expect(await fs.readFile(source, 'utf8')).toBe('# Saved source content')
          beforeRename.release()
          await finishSave.promise
        }
        return rename(source, target)
      })
      const saving = savingWindow.save({ id: savingDocument.id, content: '# Saved source content', revision: 1, saveAs: true })
      await beforeRename.promise
      const sourcePaths = () => sessions.flatMap(session => session.records().flatMap(record => record.path ? [record.path] : []))
      expect(sourcePaths()).toEqual([])
      const atomic = vi.spyOn(files, 'atomicWrite')
      const serialize = files.serialized
      vi.spyOn(files, 'serialized').mockImplementation((key, operation) => {
        const result = serialize(key, operation)
        if (key === destination.toLowerCase() || key === 'export:' + destination.toLowerCase()) exportQueued.release()
        return result
      })
      vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: destination })
      const options = { ...DEFAULT_EXPORT_OPTIONS, customPreset: 'Text', customPresets: [{ name: 'Text', extension, executable: '/unused/converter', args: ['{input}', '{output}'], input: 'markdown' as const, template: '' }] }
      const exported = exportDocument({} as BrowserWindow, exportingWindow, { id: exportingDocument.id, kind: kind as ExportFormat }, new ResourceRegistry(), options, sourcePaths)
        .then(result => ({ result, error: null }), (error: unknown) => ({ result: null, error }))
      try {
        await exportQueued.promise
        // Let a wrongly independent queue run its operation, without a timer or sleep.
        await Promise.resolve()
        expect(atomic.mock.calls.filter(([target]) => target === destination)).toHaveLength(0)
        finishSave.release()
        expect((await saving)?.path).toBe(destination)
        expect((await exported).error).toMatchObject({ code: 'CONFLICT' })
        expect(await fs.readFile(destination, 'utf8')).toBe('# Saved source content')
        expect(savingWindow.get(savingDocument.id).record.content).toBe('# Saved source content')
        expect((await fs.readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
      } finally {
        finishSave.release()
        await saving.catch(() => undefined)
        await exported
      }
    })
  }
})
