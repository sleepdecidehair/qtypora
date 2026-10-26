import type { EditorState, Text } from '@codemirror/state'
import { isSafeDataImage } from '../../shared/data-image'

export const MAX_PREVIEW_CHARACTERS = 200000
export const MAX_PREVIEW_TOKENS = 50000
const sizes = new WeakMap<Text, number>()

/** Encoded image payloads do not represent text layout work; invalid data never receives this exemption. */
export function previewContentLength(content: string): number {
  if (content.length <= MAX_PREVIEW_CHARACTERS) return content.length
  let size = content.length
  let images = 0
  for (const match of content.matchAll(/data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}/gi)) {
    const before = content.slice(Math.max(0, match.index - 600), match.index)
    const after = content.slice(match.index + match[0].length, match.index + match[0].length + 2)
    const markdownImage = /!\[[^\]\n]{0,500}\]\(\s*<?$/.test(before) && /^[>)\s]/.test(after)
    const htmlImage = /<img\b[^<>]{0,500}\bsrc\s*=\s*["']?$/i.test(before)
    if (!markdownImage && !htmlImage) continue
    if (++images > 100) return content.length
    if (isSafeDataImage(match[0])) size -= Math.max(0, match[0].length - 200)
  }
  return size
}

export function supportsPreview(state: EditorState): boolean {
  let size = sizes.get(state.doc)
  if (size === undefined) { size = previewContentLength(state.doc.toString()); sizes.set(state.doc, size) }
  return size <= MAX_PREVIEW_CHARACTERS
}
