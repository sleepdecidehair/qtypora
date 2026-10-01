export type Theme = 'light' | 'dark' | 'system'
export type SidebarMode = 'files' | 'outline' | 'search'
export type LineEnding = 'LF' | 'CRLF'

export interface Preferences {
  theme: Theme
  sidebarMode: SidebarMode
  showSidebar: boolean
  showToolbar: boolean
  sourceMode: boolean
  readingMode: boolean
  focusMode: boolean
  typewriterMode: boolean
  fontSize: number
  contentWidth: number
  contentWidthMode: 'auto' | 'fixed'
  autoSave: boolean
  autoSaveSeconds: number
  lineEnding: LineEnding
  spellcheck: boolean
  showLineNumbers: boolean
  wrapLines: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light', sidebarMode: 'outline', showSidebar: true, showToolbar: true,
  sourceMode: false, readingMode: false, focusMode: false, typewriterMode: false,
  fontSize: 16, contentWidth: 800, contentWidthMode: 'auto', autoSave: false, autoSaveSeconds: 300,
  lineEnding: 'LF', spellcheck: false, showLineNumbers: true, wrapLines: true,
}

export type ErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'PERMISSION_DENIED' |
  'CONFLICT' | 'READ_ONLY' | 'IO_ERROR' | 'UNSUPPORTED' | 'INTERNAL_ERROR'

export type Result<T> = { ok: true; data: T } | {
  ok: false; error: { code: ErrorCode; message: string }
}

export interface DocumentRecord {
  id: string
  path: string | null
  name: string
  content: string
  version: string | null
  encoding: 'utf8' | 'utf8-bom'
  lineEnding: LineEnding
  readOnly: boolean
}

export interface DocumentSnapshot { id: string; content: string; revision: number }
export interface SaveRequest extends DocumentSnapshot { saveAs?: boolean }
export interface DraftRecord extends DocumentSnapshot {
  name: string
  path: string | null
  updatedAt: string
}
export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  modifiedAt: number
}
export interface Workspace { path: string; name: string; entries: FileEntry[] }
export interface SearchRequest {
  root: string
  query: string
  caseSensitive?: boolean
}
export interface SearchHit {
  path: string
  name: string
  line: number
  text: string
}
export interface FileAction {
  action: 'create-file' | 'create-folder' | 'rename' | 'trash' | 'duplicate'
  path: string
  name?: string
}
export interface ExportRequest {
  id: string
  kind: 'html' | 'pdf' | 'markdown'
  html?: string
}
export interface BootstrapData {
  preferences: Preferences
  recentFiles: string[]
  documents: DocumentRecord[]
  drafts: DraftRecord[]
  version: string
  platform: string
  workspace?: Workspace | null
}
export type ContextMenuKind = 'editor' | 'table' | 'code' | 'math' | 'diagram' | 'image' | 'link' | 'file' | 'folder'
export type ContextMenuAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all' |
  'copy-markdown' | 'copy-html' | 'copy-plain' | 'paste-plain' |
  'bold' | 'italic' | 'strike' | 'inline-code' | 'clear-format' |
  `heading-${1 | 2 | 3 | 4 | 5 | 6}` | 'paragraph' | 'quote' | 'ordered-list' | 'bullet-list' | 'task-list' |
  'code' | 'math' | 'table' | 'horizontal-rule' | 'link' | 'insert-image' |
  'table-row-before' | 'table-row-after' | 'table-row-delete' |
  'table-column-before' | 'table-column-after' | 'table-column-delete' |
  'table-align-left' | 'table-align-center' | 'table-align-right' | 'table-delete' | 'copy-table' |
  'edit-block' | 'copy-code' | 'indent-code' | 'copy-math' | 'copy-mathml' | 'copy-diagram' |
  'open-link' | 'copy-link' | 'image-copy-path' | 'image-copy' | 'image-move' | 'image-save-as' | 'image-delete' | 'image-remove' |
  'resource-save-svg' | 'resource-save-png' | 'resource-save-jpeg' | 'view-resource' |
  'file-open' | 'file-new-window' | 'file-new-file' | 'file-new-folder' | 'file-duplicate' | 'file-rename' | 'file-trash' |
  'file-copy-path' | 'file-reveal' | 'file-refresh'
export interface ContextMenuRequest {
  kind: ContextMenuKind
  readOnly: boolean
  hasSelection: boolean
  availableActions: ContextMenuAction[]
  hasLocalResource?: boolean
  canUndo?: boolean
  canRedo?: boolean
}
export interface ClipboardContent { text: string; html?: string }
export interface ImageOperationRequest extends DocumentSnapshot { source: string; action: 'copy' | 'move' | 'delete' | 'save-as' }
export interface ImageOperationResult { source: string | null }
export interface ResourceSaveRequest { id: string; format: 'svg' | 'png' | 'jpeg'; data: string }
export type AppCommand = 'new' | 'new-window' | 'open' | 'open-folder' | 'save' |
  'save-as' | 'save-all' | 'close-document' | 'request-window-close' | 'find' | 'replace' |
  'quick-open' | 'preferences' | 'source' | 'sidebar' | 'outline' | 'files' |
  'search-folder' | 'focus' | 'typewriter' | 'toolbar' | 'export-html' | 'export-pdf' |
  'zoom-in' | 'zoom-out' | 'zoom-reset' | 'recover-drafts' | 'next-document' | 'undo' | 'redo' | 'reading' | 'select-scope' | 'insert-image'

export type DesktopEvent =
  | { type: 'command'; command: AppCommand }
  | { type: 'open-document'; document: DocumentRecord }
  | { type: 'document-changed'; id: string; kind: 'changed' | 'removed'; document: DocumentRecord | null }
  | { type: 'document-renamed'; id: string; path: string; name: string }
  | { type: 'workspace-changed'; path: string }

export interface DesktopApi {
  bootstrap(): Promise<Result<BootstrapData>>
  createDocument(): Promise<Result<DocumentRecord>>
  openFile(path?: string): Promise<Result<DocumentRecord | null>>
  openFolder(path?: string): Promise<Result<Workspace | null>>
  readDirectory(path: string): Promise<Result<FileEntry[]>>
  saveDocument(request: SaveRequest): Promise<Result<DocumentRecord | null>>
  syncDocument(snapshot: DocumentSnapshot): Promise<Result<void>>
  closeDocument(snapshot: DocumentSnapshot): Promise<Result<boolean>>
  requestWindowClose(snapshots: DocumentSnapshot[]): Promise<Result<boolean>>
  reloadDocument(id: string): Promise<Result<DocumentRecord>>
  recoverDraft(id: string): Promise<Result<DocumentRecord>>
  discardDraft(id: string): Promise<Result<void>>
  updatePreferences(preferences: Preferences): Promise<Result<Preferences>>
  fileAction(action: FileAction): Promise<Result<FileEntry | null>>
  showContextMenu(request: ContextMenuRequest): Promise<Result<ContextMenuAction | null>>
  readClipboardText(): Promise<Result<string>>
  writeClipboard(content: ClipboardContent): Promise<Result<void>>
  imageOperation(request: ImageOperationRequest): Promise<Result<ImageOperationResult | null>>
  saveResource(request: ResourceSaveRequest): Promise<Result<string | null>>
  searchFolder(request: SearchRequest): Promise<Result<SearchHit[]>>
  exportDocument(request: ExportRequest): Promise<Result<string | null>>
  insertImage(documentId: string): Promise<Result<string | null>>
  resolveResource(source: string, documentPath: string | null): Promise<Result<string>>
  openExternal(url: string): Promise<Result<void>>
  revealFile(path: string): Promise<Result<void>>
  setAlwaysOnTop(enabled: boolean): Promise<Result<void>>
  newWindow(path?: string): Promise<Result<void>>
  onEvent(callback: (event: DesktopEvent) => void): () => void
}

declare global {
  interface Window { desktop: DesktopApi }
}
