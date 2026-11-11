import type { Transaction } from '@codemirror/state'
import type { MarkdownEditorProps } from './types'

export interface TypewriterScrollRequest {
  version: number
  documentId: string
  mode: MarkdownEditorProps['mode']
  alwaysCenter: boolean
  isInput: boolean
}

export interface TypewriterScrollContext {
  version: number
  documentId: string
  mode: MarkdownEditorProps['mode']
  typewriterMode: boolean
  alwaysCenter: boolean
  composing: boolean
  restoringScroll: boolean
}

export function isTypewriterInputChange(transactions: readonly Transaction[]): boolean {
  return transactions.some(transaction => transaction.docChanged && (transaction.isUserEvent('input') || transaction.isUserEvent('delete')))
}

export function changesTypewriterPosition(transactions: readonly Transaction[]): boolean {
  return transactions.some(transaction => transaction.docChanged || !transaction.startState.selection.eq(transaction.newSelection, true))
}

export function shouldApplyTypewriterScroll(request: TypewriterScrollRequest, context: TypewriterScrollContext): boolean {
  return request.version === context.version && request.documentId === context.documentId && request.mode === context.mode &&
    request.mode !== 'reading' && context.typewriterMode && request.alwaysCenter === context.alwaysCenter &&
    (request.alwaysCenter || request.isInput) && !context.composing && !context.restoringScroll
}
