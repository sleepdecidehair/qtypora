import type { EditorView } from '@codemirror/view'
import { paragraphBreak } from './paragraph-break'

/** Block destructive source splits before Markdown's high-priority Enter handler. */
export function guardParagraphBreak(view: EditorView, mode: 'source' | 'hybrid'): boolean {
  return !view.compositionStarted && paragraphBreak(view.state, mode) === 'blocked'
}
