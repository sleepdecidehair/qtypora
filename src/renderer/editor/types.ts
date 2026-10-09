export type EditorAction = 'bold' | 'italic' | 'strike' | 'inline-code' | 'link' |
  'image' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4' | 'heading-5' |
  'heading-6' | 'paragraph' | 'quote' | 'bullet-list' | 'ordered-list' | 'task-list' |
  'code' | 'math' | 'table' | 'rule' | 'undo' | 'redo' | 'select-all' | 'find' |
  'replace' | 'clear-format' | 'focus-editor' | 'select-scope'

export interface EditorCommand { id: number; action: EditorAction; value?: string }
export interface JumpRequest { id: number; line: number }
export interface EditorSelection { text: string; from: number; to: number }
export interface MarkdownEditorProps {
  platform: string
  desktopApi: DesktopApi
  documentId: string
  revision: number
  value: string
  mode: 'hybrid' | 'source' | 'reading'
  theme: 'light' | 'dark'
  fontSize: number
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
