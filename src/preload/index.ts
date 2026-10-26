import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { SessionSpelling } from '../shared/spelling'
import type { DesktopApi, DesktopEvent, Result } from '../shared/contracts'

const invoke = <T>(method: string, ...args: unknown[]): Promise<Result<T>> => ipcRenderer.invoke(`qtypora:${method}`, ...args) as Promise<Result<T>>
const spelling = new SessionSpelling()
const localSpelling = async <T>(operation: () => T): Promise<Result<T>> => {
  try { return { ok: true, data: operation() } }
  catch (error) { return { ok: false, error: { code: 'INVALID_INPUT', message: error instanceof Error ? error.message : '拼写操作失败。' } } }
}

const desktop: DesktopApi = {
  bootstrap: () => invoke('bootstrap'),
  createDocument: () => invoke('createDocument'),
  openLinkedFile: (request) => invoke('openLinkedFile', request),
  openFile: (path) => invoke('openFile', path),
  openFolder: (path) => invoke('openFolder', path),
  readDirectory: (path, options) => invoke('readDirectory', path, options),
  saveDocument: (request) => invoke('saveDocument', request),
  syncDocument: (snapshot) => invoke('syncDocument', snapshot),
  closeDocument: (snapshot) => invoke('closeDocument', snapshot),
  requestWindowClose: (snapshots) => invoke('requestWindowClose', snapshots),
  reloadDocument: (id) => invoke('reloadDocument', id),
  recoverDraft: (id) => invoke('recoverDraft', id),
  discardDraft: (id) => invoke('discardDraft', id),
  patchPreferences: (changes) => invoke('patchPreferences', changes),
  resolveExportImage: (request) => invoke('resolveExportImage', request),
  updatePreferences: (preferences) => invoke('updatePreferences', preferences),
  fileAction: (action) => invoke('fileAction', action),
  moveFile: (request) => invoke('moveFile', request),
  undoFileOperation: () => invoke('undoFileOperation'),
  showContextMenu: (request) => invoke('showContextMenu', request),
  readSpelling: (word) => localSpelling(() => spelling.read(webFrame, word)),
  learnSpelling: (word) => invoke('learnSpelling', word),
  forgetSpelling: (word) => invoke('forgetSpelling', word),
  listSpellingWords: () => invoke('listSpellingWords'),
  ignoreSpelling: (word) => localSpelling(() => spelling.ignore(word)),
  restoreSpelling: (word) => localSpelling(() => spelling.restore(word)),
  listIgnoredSpellingWords: () => localSpelling(() => spelling.list()),
  clearIgnoredSpellingWords: () => localSpelling(() => spelling.clear()),
  readClipboardText: () => invoke('readClipboardText'),
  readClipboard: () => invoke('readClipboard'),
  writeClipboard: (content) => invoke('writeClipboard', content),
  imageOperation: (request) => invoke('imageOperation', request),
  saveResource: (request) => invoke('saveResource', request),
  searchFolder: (request) => invoke('searchFolder', request),
  getExportPlan: (request) => invoke('getExportPlan', request),
  exportDocument: (request) => invoke('exportDocument', request),
  importExportPresets: () => invoke('importExportPresets'),
  exportExportPresets: (presets) => invoke('exportExportPresets', presets),
  applyExportPresetImport: (presets, strategy) => invoke('applyExportPresetImport', presets, strategy),
  printDocument: (request) => invoke('printDocument', request),
  importDocument: () => invoke('importDocument'),
  importImages: (request) => invoke('importImages', request),
  uploadImages: (request) => invoke('uploadImages', request),
  organizeImages: (request) => invoke('organizeImages', request),
  setZoomFactor: (factor) => invoke('setZoomFactor', factor),
  insertImage: (documentId) => invoke('insertImage', documentId),
  resolveResource: (source, documentPath) => invoke('resolveResource', source, documentPath),
  openExternal: (url) => invoke('openExternal', url),
  revealFile: (path) => invoke('revealFile', path),
  setAlwaysOnTop: (enabled) => invoke('setAlwaysOnTop', enabled),
  newWindow: (path) => invoke('newWindow', path),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopEvent): void => callback(payload)
    ipcRenderer.on('qtypora:event', listener)
    return () => { ipcRenderer.removeListener('qtypora:event', listener) }
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)
