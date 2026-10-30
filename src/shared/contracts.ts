import type { ShortcutOverrides } from './shortcuts'
import { DEFAULT_EXPORT_OPTIONS, type ExportFormat, type ExportOptions } from './export-options'
import { DEFAULT_MARKDOWN_OPTIONS, type MarkdownOptions } from './markdown-options'
import { DEFAULT_WORKSPACE_OPTIONS, type WorkspaceOptions } from './workspace-options'
import { DEFAULT_IMAGE_OPTIONS, type ImageOptions, type ImageImportRequest, type ImageImportResult } from './image-options'
import type { AppLocale } from './i18n'

export type Theme = 'light' | 'dark' | 'system'
export type SidebarMode = 'files' | 'outline' | 'search'
export type LineEnding = 'LF' | 'CRLF'

export interface Preferences {
  locale: AppLocale
  theme: Theme
  sidebarMode: SidebarMode
  outlineFlat: boolean
  indentFirstLine: boolean
  showSidebar: boolean
  showToolbar: boolean
  showStatusBar: boolean
  macNativeTabs: boolean
  typoraThemeId: string
  floatingToolbar: boolean
  shortcuts: ShortcutOverrides
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
  markdown: MarkdownOptions
  workspace: WorkspaceOptions
  image: ImageOptions
  export: ExportOptions
  readingSpeed: number
  statisticsUnit: 'words' | 'characters'
  fontFamily: string
  lineHeight: number
  lightTheme: 'paper' | 'sepia' | 'blue'
  darkTheme: 'night' | 'charcoal'
  customCss: string
  zoomFactor: number
  startup: 'new' | 'last-file' | 'last-folder' | 'custom-folder'
  startupFolder: string
  spellcheckLanguages: string[]
}

export const DEFAULT_PREFERENCES: Preferences = {
  locale: 'zh-CN',
  theme: 'light', sidebarMode: 'outline', outlineFlat: false, indentFirstLine: false, showSidebar: true, showToolbar: true, showStatusBar: true, macNativeTabs: false, typoraThemeId: '', floatingToolbar: true, shortcuts: {},
  sourceMode: false, readingMode: false, focusMode: false, typewriterMode: false,
  fontSize: 16, contentWidth: 800, contentWidthMode: 'auto', autoSave: false, autoSaveSeconds: 300,
  lineEnding: 'LF', spellcheck: false, showLineNumbers: true, wrapLines: true,
  markdown: DEFAULT_MARKDOWN_OPTIONS, workspace: DEFAULT_WORKSPACE_OPTIONS, image: DEFAULT_IMAGE_OPTIONS, export: DEFAULT_EXPORT_OPTIONS,
  readingSpeed: 300, statisticsUnit: 'words', fontFamily: '', lineHeight: 1.8, lightTheme: 'paper', darkTheme: 'night', customCss: '', zoomFactor: 1,
  startup: 'new', startupFolder: '', spellcheckLanguages: ['en-US'],
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
  pendingLineEnding?: LineEnding | null
  savedLineEndingConversion?: LineEnding
  readOnly: boolean
  unsaved?: boolean
}

export interface SystemVersionSummary { token: string; modifiedAt: string }
export interface SystemVersionPreview { content: string; encoding: 'utf8' | 'utf8-bom' }
export interface CloseSavedDocument { document: DocumentRecord; revision: number }
export type CloseResult = { ok: true; data: { closed: boolean; saved: CloseSavedDocument[] } } | { ok: false; error: { code: ErrorCode; message: string }; saved?: CloseSavedDocument[] }
export type RestoredCloseResult = { ok: true; data: DocumentRecord } | { ok: false; error: { code: ErrorCode; message: string }; document?: DocumentRecord }
export type SaveResult = { ok: true; data: DocumentRecord | null } | { ok: false; error: { code: ErrorCode; message: string }; document?: DocumentRecord }

export interface DocumentSnapshot { id: string; content: string; revision: number; pendingLineEnding?: LineEnding | null }
export interface SaveRequest extends DocumentSnapshot { saveAs?: boolean }
export interface DraftRecord extends DocumentSnapshot {
  name: string
  path: string | null
  updatedAt: string
  baseVersion?: string | null
  encoding?: 'utf8' | 'utf8-bom'
}
export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  modifiedAt: number
  createdAt?: number
}
export interface Workspace { path: string; name: string; entries: FileEntry[] }
export interface SearchRequest {
  root: string
  query: string
  excludeDirectories?: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}
export interface SearchHit {
  path: string
  name: string
  line: number
  text: string
}
export interface SearchResults {
  hits: SearchHit[]
  limitations: { resultLimit: boolean; entryLimit: boolean; oversizedFiles: number }
}
export interface FileAction {
  action: 'create-file' | 'create-folder' | 'rename' | 'trash' | 'duplicate'
  path: string
  name?: string
}
export interface ExportRequest {
  preferencesVersion?: number
  historyVersion?: number
  id: string
  kind: ExportFormat
  html?: string
  revision?: number
  reusePrevious?: boolean
  overwritePrevious?: boolean
}
export interface BootstrapData {
  preferencesVersion?: number
  preferences: Preferences
  recentFiles: string[]
  recentFolders?: string[]
  documents: DocumentRecord[]
  drafts: DraftRecord[]
  version: string
  platform: string
  nativeTabsEnabled?: boolean
  workspace?: Workspace | null
}
export type ContextMenuKind = 'editor' | 'table' | 'code' | 'math' | 'diagram' | 'image' | 'link' | 'file' | 'folder' | 'outline'
export type ContextMenuAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all' |
  'copy-markdown' | 'copy-html' | 'copy-plain' | 'copy-without-theme' | 'paste-plain' |
  'bold' | 'italic' | 'underline' | 'strike' | 'inline-code' | 'clear-format' |
  `heading-${1 | 2 | 3 | 4 | 5 | 6}` | 'paragraph' | 'quote' | 'ordered-list' | 'bullet-list' | 'task-list' |
  'code' | 'math' | 'table' | 'horizontal-rule' | 'link' | 'insert-image' |
  'table-row-before' | 'table-row-after' | 'table-row-delete' |
  'table-column-before' | 'table-column-after' | 'table-column-delete' |
  'table-align-left' | 'table-align-center' | 'table-align-right' | 'table-delete' | 'copy-table' |
  'edit-block' | 'copy-code' | 'indent-code' | 'copy-math' | 'copy-mathml' | 'copy-diagram' |
  'open-link' | 'copy-link' | 'image-resize' | 'image-upload' | 'image-copy-path' | 'image-copy' | 'image-move' | 'image-save-as' | 'image-delete' | 'image-remove' |
  'resource-save-svg' | 'resource-save-png' | 'resource-save-jpeg' | 'view-resource' |
  'file-open' | 'file-new-window' | 'file-new-file' | 'file-new-folder' | 'file-duplicate' | 'file-rename' | 'file-trash' |
  'spell-learn' | 'spell-ignore' | `spell-suggestion-${0 | 1 | 2 | 3 | 4}` | 'file-copy-path' | 'file-reveal' | 'file-refresh' | 'file-move' | 'file-undo-move' | 'outline-collapsible' | 'outline-flat' | 'outline-filter' | 'outline-expand-all' | 'outline-collapse-all' | 'outline-locate'
export interface ContextMenuRequest {
  kind: ContextMenuKind
  readOnly: boolean
  hasSelection: boolean
  availableActions: ContextMenuAction[]
  hasLocalResource?: boolean
  spelling?: { word: string; suggestions: string[] }
  canUndo?: boolean
  canRedo?: boolean
  outlineFlat?: boolean
  outlineFilter?: boolean
}
export interface ClipboardContent { text: string; html?: string; rtf?: string }
export interface ClipboardPayload extends ClipboardContent { images?: import('./image-options').ImportedImage[] }
export interface ImageOperationRequest extends DocumentSnapshot { source: string; action: 'copy' | 'move' | 'delete' | 'save-as' }
export interface ImageOperationResult { source: string | null }
export interface ResourceSaveRequest { id: string; format: 'svg' | 'png' | 'jpeg'; data: string }
export type AppCommand = 'article-list' | 'toggle-soft-breaks' | 'line-ending-lf' | 'line-ending-crlf' | 'toggle-spellcheck' | 'page-setup' | 'reveal-current-file' | 'indent-first-line' | 'replace-next' | 'find-next' | 'find-previous' | 'html-comment' | 'toggle-always-on-top' | 'statusbar' | 'inline-math' | 'new' | 'new-window' | 'open' | 'open-folder' | 'save' |
  'save-as' | 'save-all' | 'close-document' | 'request-window-close' | 'find' | 'replace' |
  'quick-open' | 'preferences' | 'source' | 'sidebar' | 'outline' | 'files' |
  'search-folder' | 'focus' | 'typewriter' | 'toolbar' | 'export-html' | 'export-pdf' |
  'zoom-in' | 'zoom-out' | 'zoom-reset' | 'recover-drafts' | 'next-document' | 'undo' | 'redo' | 'reading' | 'select-scope' | 'select-word' | 'delete-word' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4' | 'heading-5' | 'heading-6' | 'paragraph' | 'quote' | 'bullet-list' | 'ordered-list' | 'task-list' | 'code' | 'math' | 'table' | 'rule' | 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'superscript' | 'subscript' | 'inline-code' | 'link' | 'clear-format' | 'select-block' | 'delete-block' | 'delete-style' | 'copy-markdown' | 'copy-plain' | 'copy-html' | 'heading-promote' | 'heading-demote' | 'insert-toc' | 'insert-yaml' | 'insert-alert-note' | 'insert-alert-tip' | 'insert-alert-important' | 'insert-alert-warning' | 'insert-alert-caution' | 'insert-footnote' | 'paragraph-before' | 'paragraph-after' | 'task-check' | 'task-uncheck' | 'task-toggle' | 'share-document' | 'new-native-tab' | 'reopen-closed' | 'select-line' | 'delete-line' | 'jump-start' | 'jump-end' | 'jump-line-start' | 'jump-line-end' | 'jump-selection' | 'insert-image' |
  'export-options' | 'export-previous' | 'export-overwrite' | 'print' | 'import' | 'statistics' | 'upload-images' | 'organize-images' | 'system-versions'

export type DesktopEvent =
  | { type: 'command'; command: AppCommand }
  | { type: 'validate-close'; requestId: string; snapshots: DocumentSnapshot[] }
  | { type: 'window-close-prevented'; error?: string }
  | { type: 'open-document'; document: DocumentRecord }
  | { type: 'document-changed'; id: string; kind: 'changed' | 'removed'; document: DocumentRecord | null }
  | { type: 'document-renamed'; id: string; path: string; name: string }
  | { type: 'workspace-changed'; path: string }
  | { type: 'preferences-changed'; preferences: Preferences; version: number }
  | { type: 'user-themes-changed'; revision: number }

export interface ThemeFile { id: string; name: string }
export interface ThemeSnapshot extends ThemeFile { css: string; globalCss: string; overrideCss: string; version: string }

export interface DesktopApi {
  listUserThemes(): Promise<Result<ThemeFile[]>>
  readUserTheme(id: string): Promise<Result<ThemeSnapshot>>
  revealUserThemes(): Promise<Result<void>>
  bootstrap(): Promise<Result<BootstrapData>>
  createDocument(): Promise<Result<DocumentRecord>>
  reopenClosedFile(): Promise<Result<DocumentRecord | null>>
  openLinkedFile(request: { id: string; target: string }): Promise<Result<{ document: DocumentRecord | null; fragment: string | null } | null>>
  openFile(path?: string): Promise<Result<DocumentRecord | null>>
  openFolder(path?: string): Promise<Result<Workspace | null>>
  readDirectory(path: string, options?: WorkspaceOptions): Promise<Result<FileEntry[]>>
  saveDocument(request: SaveRequest): Promise<SaveResult>
  syncDocument(snapshot: DocumentSnapshot): Promise<Result<void>>
  listSystemVersions(snapshot: DocumentSnapshot): Promise<Result<SystemVersionSummary[]>>
  readSystemVersion(request: { snapshot: DocumentSnapshot; token: string }): Promise<Result<SystemVersionPreview>>
  setNativeDocumentState(id: string | null, edited: boolean): Promise<Result<void>>
  showNativeShare(snapshot: DocumentSnapshot): Promise<Result<void>>
  newNativeTab(): Promise<Result<void>>
  closeDocument(snapshot: DocumentSnapshot): Promise<CloseResult>
  restoreClosedEdit(snapshot: DocumentSnapshot): Promise<RestoredCloseResult>
  requestWindowClose(snapshots: DocumentSnapshot[]): Promise<CloseResult>
  cancelWindowCloseRequest(): Promise<Result<void>>
  resolveCloseValidation(requestId: string, valid: boolean): Promise<Result<void>>
  reloadDocument(id: string): Promise<Result<DocumentRecord>>
  recoverDraft(id: string): Promise<Result<DocumentRecord>>
  discardDraft(id: string): Promise<Result<void>>
  patchPreferences(changes: import('./preference-patch').PreferencesPatch): Promise<Result<{ preferences: Preferences; version: number }>>
  resolveExportImage(request: { id: string; source: string }): Promise<Result<string>>
  updatePreferences(preferences: Preferences): Promise<Result<Preferences>>
  fileAction(action: FileAction): Promise<Result<FileEntry | null>>
  moveFile(request: { path: string; destinationDirectory: string }): Promise<Result<FileEntry | null>>
  undoFileOperation(): Promise<Result<FileEntry | null>>
  showContextMenu(request: ContextMenuRequest): Promise<Result<ContextMenuAction | null>>
  readSpelling(word: string): Promise<Result<import('./spelling').SpellingResult>>
  learnSpelling(word: string): Promise<Result<void>>
  forgetSpelling(word: string): Promise<Result<void>>
  listSpellingWords(): Promise<Result<string[]>>
  ignoreSpelling(word: string): Promise<Result<string[]>>
  restoreSpelling(word: string): Promise<Result<string[]>>
  listIgnoredSpellingWords(): Promise<Result<string[]>>
  clearIgnoredSpellingWords(): Promise<Result<string[]>>
  readClipboardText(): Promise<Result<string>>
  readClipboard(): Promise<Result<ClipboardPayload>>
  writeClipboard(content: ClipboardContent): Promise<Result<void>>
  imageOperation(request: ImageOperationRequest): Promise<Result<ImageOperationResult | null>>
  saveResource(request: ResourceSaveRequest): Promise<Result<string | null>>
  searchFolder(request: SearchRequest): Promise<Result<SearchResults>>
  getExportPlan(request: ExportRequest): Promise<Result<{ kind: ExportFormat; requiresHtml: boolean; options: ExportOptions; preferencesVersion: number; historyVersion: number }>>
  exportDocument(request: ExportRequest): Promise<Result<string | null>>
  importExportPresets(): Promise<Result<import('./export-preset-file').ImportedExportPresets | null>>
  exportExportPresets(presets: import('./export-options').SavedExportPreset[]): Promise<Result<string | null>>
  applyExportPresetImport(presets: import('./export-options').SavedExportPreset[], strategy: import('./export-preset-file').PresetConflictStrategy): Promise<Result<{ preferences: Preferences; version: number }>>
  printDocument(request: ExportRequest): Promise<Result<boolean>>
  importDocument(): Promise<Result<DocumentRecord | null>>
  importImages(request: ImageImportRequest): Promise<Result<ImageImportResult | null>>
  chooseImages(): Promise<Result<import('./image-options').ImportedImage[] | null>>
  uploadImages(request: import('./image-options').UploadImagesRequest): Promise<Result<import('./image-options').UploadImagesResult>>
  organizeImages(request: import('./image-options').UploadImagesRequest): Promise<Result<import('./image-options').UploadImagesResult | null>>
  setZoomFactor(factor: number): Promise<Result<void>>
  insertImage(documentId: string): Promise<Result<string | null>>
  resolveResource(source: string, documentPath: string | null): Promise<Result<string>>
  openExternal(url: string): Promise<Result<void>>
  revealFile(path: string): Promise<Result<void>>
  setAlwaysOnTop(enabled: boolean): Promise<Result<void>>
  toggleAlwaysOnTop(): Promise<Result<boolean>>
  newWindow(path?: string): Promise<Result<void>>
  onEvent(callback: (event: DesktopEvent) => void): () => void
}

declare global {
  interface Window { desktop: DesktopApi }
}
