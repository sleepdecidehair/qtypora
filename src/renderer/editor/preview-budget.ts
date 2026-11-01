import type { EditorState } from '@codemirror/state'

export const MAX_PREVIEW_CHARACTERS = 200000
export const MAX_PREVIEW_TOKENS = 50000

export function supportsPreviewLength(length: number): boolean { return length <= MAX_PREVIEW_CHARACTERS }

export function supportsPreview(state: EditorState): boolean { return supportsPreviewLength(state.doc.length) }
