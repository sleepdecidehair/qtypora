import { StateEffect, StateField } from '@codemirror/state'
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'
import { findTextMatches, indexArticleText, matchRange } from './reading-search'

export interface FolderSearchQuery { query: string; caseSensitive: boolean }

export const setFolderSearch = StateEffect.define<FolderSearchQuery | null>()
const folderSearch = StateField.define<FolderSearchQuery | null>({
  create: () => null,
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(setFolderSearch)) value = effect.value
    return value
  },
})

const MATCH_NAME = 'qtypora-folder-search'
const ACTIVE_NAME = 'qtypora-folder-search-active'
const SEARCH_ROOTS = '.cm-line,.cm-live-block-content,.cm-live-table th,.cm-live-table td'

// Paint rendered text without inserting markup into CodeMirror or editable table cells.
const highlights = ViewPlugin.fromClass(class {
  private frame: number | null = null
  private matches = new Highlight()
  private active = new Highlight()
  private observer: MutationObserver

  constructor(readonly view: EditorView) {
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(view.contentDOM, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'hidden', 'aria-hidden'] })
    this.schedule()
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setFolderSearch)))) this.schedule()
  }

  private schedule(): void {
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => { this.frame = null; this.refresh() })
  }

  private refresh(): void {
    this.matches.clear(); this.active.clear()
    const search = this.view.state.field(folderSearch)
    if (!search?.query.trim()) { this.clear(); return }
    const activeLine = this.view.state.doc.lineAt(this.view.state.selection.main.head).number
    for (const root of this.view.contentDOM.querySelectorAll<HTMLElement>(SEARCH_ROOTS)) {
      if (root.parentElement?.closest(SEARCH_ROOTS)) continue
      const index = indexArticleText(root, 'button,input,select,textarea')
      const sourceLine = root.dataset.sourceLine ? Number(root.dataset.sourceLine) : root.classList.contains('cm-line') ? this.view.state.doc.lineAt(this.view.posAtDOM(root)).number : Number(root.closest<HTMLElement>('[data-source-line]')?.dataset.sourceLine)
      for (const match of findTextMatches(index.text, search.query, search.caseSensitive)) {
        const range = matchRange(index, match)
        if (!range) continue
        this.matches.add(range)
        if (sourceLine === activeLine) this.active.add(range)
      }
    }
    CSS.highlights.set(MATCH_NAME, this.matches)
    CSS.highlights.set(ACTIVE_NAME, this.active)
  }

  private clear(): void {
    if (CSS.highlights.get(MATCH_NAME) === this.matches) CSS.highlights.delete(MATCH_NAME)
    if (CSS.highlights.get(ACTIVE_NAME) === this.active) CSS.highlights.delete(ACTIVE_NAME)
  }

  destroy(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.clear()
  }
})

export const folderSearchHighlight = [folderSearch, highlights]
