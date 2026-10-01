import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi, DesktopEvent, Result } from '../shared/contracts'

const invoke = <T>(method: string, ...args: unknown[]): Promise<Result<T>> => ipcRenderer.invoke(`qtypora:${method}`, ...args) as Promise<Result<T>>

const desktop: DesktopApi = {
  bootstrap: () => invoke('bootstrap'),
  createDocument: () => invoke('createDocument'),
  openFile: (path) => invoke('openFile', path),
  openFolder: (path) => invoke('openFolder', path),
  readDirectory: (path) => invoke('readDirectory', path),
  saveDocument: (request) => invoke('saveDocument', request),
  syncDocument: (snapshot) => invoke('syncDocument', snapshot),
  closeDocument: (snapshot) => invoke('closeDocument', snapshot),
  requestWindowClose: (snapshots) => invoke('requestWindowClose', snapshots),
  reloadDocument: (id) => invoke('reloadDocument', id),
  recoverDraft: (id) => invoke('recoverDraft', id),
  discardDraft: (id) => invoke('discardDraft', id),
  updatePreferences: (preferences) => invoke('updatePreferences', preferences),
  fileAction: (action) => invoke('fileAction', action),
  showContextMenu: (request) => invoke('showContextMenu', request),
  readClipboardText: () => invoke('readClipboardText'),
  writeClipboard: (content) => invoke('writeClipboard', content),
  imageOperation: (request) => invoke('imageOperation', request),
  saveResource: (request) => invoke('saveResource', request),
  searchFolder: (request) => invoke('searchFolder', request),
  exportDocument: (request) => invoke('exportDocument', request),
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
