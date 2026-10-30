import { isolateHistory } from '@codemirror/commands'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { markdownOptionsFacet } from './markdown-config'
import { editLiveBlock } from './live-blocks'
import { supportsPreview } from './preview-budget'

/** Insert an empty front matter block without rewriting any existing source. */
export function insertYamlFrontMatter(state: EditorState): TransactionSpec | null {
  if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty || !state.facet(markdownOptionsFacet).frontMatter || !supportsPreview(state)) return null
  const first = state.doc.line(1).text
  // A leading delimiter may already be front matter or an unfinished block.
  if (/^---\s*$/.test(first) || first.startsWith('\ufeff')) return null
  const insert = '---\n\n---\n' + (state.doc.length ? '\n' : '')
  return { changes: { from: 0, insert }, selection: { anchor: 4 }, effects: editLiveBlock.of({ from: 0, to: 8 }), annotations: isolateHistory.of('full'), userEvent: 'input.insert-yaml', scrollIntoView: true }
}
