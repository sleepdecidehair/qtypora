export type EditorAction = 'replace-next' | 'find-next' | 'find-previous' | 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'superscript' | 'subscript' | 'inline-code' | 'inline-math' | 'html-comment' | 'link' |
  'image' | 'choose-image' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4' | 'heading-5' |
  'heading-6' | 'paragraph' | 'quote' | 'bullet-list' | 'ordered-list' | 'task-list' |
  'code' | 'math' | 'table' | 'rule' | 'undo' | 'redo' | 'select-all' | 'find' |
  'upload-images' | 'organize-images' | 'replace' | 'clear-format' | 'focus-editor' | 'select-scope' | 'select-word' | 'delete-word' | 'select-block' | 'delete-block' | 'delete-style' | 'copy-markdown' | 'copy-plain' | 'copy-html' | 'heading-promote' | 'heading-demote' | 'insert-toc' | 'insert-yaml' | 'insert-alert-note' | 'insert-alert-tip' | 'insert-alert-important' | 'insert-alert-warning' | 'insert-alert-caution' | 'insert-footnote' | 'paragraph-before' | 'paragraph-after' | 'task-check' | 'task-uncheck' | 'task-toggle' | 'select-line' | 'delete-line' | 'jump-start' | 'jump-end' | 'jump-line-start' | 'jump-line-end' | 'jump-selection'

export interface EditorCommand { id: number; action: EditorAction; value?: string; releaseCloseTask?: () => void }
export interface JumpRequest { id: number; line: number; documentId?: string }
export interface EditorSelection { text: string; from: number; to: number }
export interface MarkdownEditorProps {
  closeCoordinator: import('./close-coordinator').CloseCoordinator
  closeHandleRef: import('react').RefObject<import('./close-guard').EditorCloseHandle | null>
  onCommandStarted: (id: number) => void
  locale?: import('../../shared/i18n').AppLocale
  platform: string
  desktopApi: DesktopApi
  documentId: string
  revision: number
  encoding: import('../../shared/contracts').DocumentRecord['encoding']
  lineEnding: import('../../shared/contracts').LineEnding
  value: string
  mode: 'hybrid' | 'source' | 'reading'
  theme: 'light' | 'dark'
  fontSize: number
  indentFirstLine: boolean
  markdownOptions: import('../../shared/markdown-options').MarkdownOptions
  imageOptions: import('../../shared/image-options').ImageOptions
  focusMode: boolean
  typewriterMode: boolean
  readOnly: boolean
  lineNumbers: boolean
  wrapLines: boolean
  spellcheck: boolean
  command: EditorCommand | null
  jumpToLine: JumpRequest | null
  folderSearch?: import('./folder-search-highlight').FolderSearchQuery | null
  onChange: (value: string) => void
  onSelectionChange: (selection: EditorSelection) => void
  onLinkOpen: (target: string) => void
  resolveResource: (source: string) => Promise<string>
}
import type { DesktopApi } from '../../shared/contracts'
