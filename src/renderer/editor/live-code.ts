import { supportsPreview } from './preview-budget'
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension, type Range, type TransactionSpec } from '@codemirror/state'
import { indentRange, syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet } from '@codemirror/view'
import { editLiveBlock, liveEditingBlock } from './live-blocks'
import { attachCodeLanguageSuggestions } from './code-language-suggestions'
import { markdownOptionsFacet } from './markdown-config'
import { codeLanguageInputValue } from './code-languages'
import { translate, type AppLocale } from '../../shared/i18n'

import { editorLocale } from './editor-i18n'
export { editorLocale } from './editor-i18n'

export interface LiveCodeBlock {
  from: number
  to: number
  bodyFrom: number
  bodyTo: number
  firstLine: number
  lastLine: number
  opening: string
  language: string
}

export interface CodeBlockDisplay { lineNumbers?: boolean; wrapLines?: boolean }
export const setCodeBlockDisplay = StateEffect.define<{ from: number; display: CodeBlockDisplay }>({
  map: (value, changes) => ({ ...value, from: changes.mapPos(value.from, 1) }),
})

/** Presentation-only overrides live in each EditorState, never in Markdown. */
export const codeBlockDisplay = StateField.define<ReadonlyMap<number, CodeBlockDisplay>>({
  create: () => new Map(),
  update: (previous, transaction) => {
    let next = previous
    if (transaction.docChanged && previous.size) {
      const blocks = new Set(liveCodeBlocks(transaction.state).map(block => block.from))
      const ranges: { from: number; to: number }[] = []
      transaction.changes.iterChangedRanges((from, to) => { if (to > from) ranges.push({ from, to }) })
      // Parsing the old document is only needed when a change touches an overridden
      // opening fence; ordinary typing inside a body never needs a second parse.
      const touchesOpening = [...previous.keys()].some(start => ranges.some(range => range.from <= start && range.to > start))
      const oldBlocks = touchesOpening ? new Map(liveCodeBlocks(transaction.startState).map(block => [block.from, block])) : null
      const mapped = new Map<number, CodeBlockDisplay>()
      for (const [from, display] of previous) {
        const oldBlock = oldBlocks?.get(from)
        if (oldBlock && ranges.some(range => range.from <= from && range.to >= oldBlock.to)) continue
        const after = transaction.changes.mapPos(from, 1)
        const before = transaction.changes.mapPos(from, -1)
        const position = blocks.has(after) ? after : before
        if (blocks.has(position)) mapped.set(position, display)
      }
      next = mapped
    }
    for (const effect of transaction.effects) if (effect.is(setCodeBlockDisplay)) {
      if (!liveCodeBlocks(transaction.state).some(block => block.from === effect.value.from)) continue
      const changed = new Map(next)
      if (effect.value.display.lineNumbers === undefined && effect.value.display.wrapLines === undefined) changed.delete(effect.value.from)
      else changed.set(effect.value.from, effect.value.display)
      next = changed
    }
    return next
  },
})

export function liveCodeBlocks(state: EditorState): LiveCodeBlock[] {
  const blocks: LiveCodeBlock[] = []
  if (!supportsPreview(state)) return blocks
  syntaxTree(state).iterate({ enter: (node) => {
    if (node.name !== 'FencedCode') return
    if (node.node.parent?.name !== 'Document') return false
    const marks = node.node.getChildren('CodeMark')
    if (marks.length !== 2) return false
    const first = state.doc.lineAt(marks[0].from)
    const last = state.doc.lineAt(marks[1].from)
    const language = node.node.getChild('CodeInfo')
    const info = language ? state.doc.sliceString(language.from, language.to).trim() : ''
    if ((state.facet(markdownOptionsFacet).diagrams && ['mermaid', 'sequence', 'flow'].includes(info.split(/\s+/)[0].toLowerCase())) || last.number <= first.number + 1) return false
    blocks.push({ from: first.from, to: last.to, bodyFrom: first.to + 1, bodyTo: last.from - 1, firstLine: first.number, lastLine: last.number, opening: first.text, language: info })
    return false
  } })
  return blocks
}

export function fenceCreation(state: EditorState): TransactionSpec | null {
  const selection = state.selection.main
  if (state.readOnly || !supportsPreview(state) || state.selection.ranges.length !== 1 || !selection.empty) return null
  const line = state.doc.lineAt(selection.head)
  const match = /^( {0,3})(`{3,})([^`\n]*)$/.exec(line.text)
  if (!match || selection.head !== line.to) return null
  let node = syntaxTree(state).resolveInner(selection.head, -1)
  while (node.parent && node.name !== 'FencedCode') node = node.parent
  if (node.name !== 'FencedCode' || node.parent?.name !== 'Document' || state.doc.lineAt(node.from).number !== line.number || node.getChildren('CodeMark').length > 1) return null
  const settings = state.facet(markdownOptionsFacet)
  const language = match[3].trim() || settings.codeDefaultLanguageMode === 'menu' ? '' : settings.defaultCodeLanguage
  const insert = `${language}\n\n${match[1]}${match[2]}`
  return {
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + language.length + 1),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.code-fence',
    scrollIntoView: true,
    ...(state.facet(markdownOptionsFacet).diagrams && ['mermaid', 'sequence', 'flow'].includes((match[3].trim() || language).toLowerCase()) ? { effects: editLiveBlock.of({ from: line.from, to: line.to + insert.length }) } : {}),
  }
}

export function confirmCodeFence(view: Pick<EditorView, 'state' | 'composing'> & { dispatch: (spec: TransactionSpec) => void }): boolean {
  if (view.composing) return false
  const transaction = fenceCreation(view.state)
  if (!transaction) return false
  view.dispatch(transaction)
  // CM history records the post-change caret through a subsequent selection event.
  // Without this, redo maps the old caret past the whole inserted closing fence.
  view.dispatch({ selection: view.state.selection, userEvent: 'select.code' })
  return true
}

function selectedCode(state: EditorState): LiveCodeBlock | undefined {
  if (!state.field(codeDecorations, false)) return
  const { from, to } = state.selection.main
  return liveCodeBlocks(state).find((block) => from >= block.bodyFrom && to <= block.bodyTo)
}

const codeSelectAllPending = StateField.define<boolean>({
  create: () => false,
  update: (value, transaction) => transaction.isUserEvent('select.code-all') ? true : transaction.docChanged || transaction.selection ? false : value,
})

export function selectLiveCode(view: EditorView): boolean {
  const state = view.state
  if (!state.field(codeDecorations, false)) return false
  const blocks = liveCodeBlocks(state)
  if (!blocks.length) return false
  const selection = state.selection.main
  const onlyCode = blocks.length === 1 && !state.doc.sliceString(0, blocks[0].from).trim() && !state.doc.sliceString(blocks[0].to).trim()
  const active = selectedCode(state)
  if (active && state.field(codeSelectAllPending) && selection.from === active.bodyFrom && selection.to === active.bodyTo && !onlyCode) return false
  if (!active && !selection.empty && selection.from === 0 && selection.to === state.doc.length) return false
  const distance = (block: LiveCodeBlock): number => selection.head < block.bodyFrom ? block.bodyFrom - selection.head : Math.max(0, selection.head - block.bodyTo)
  const block = active ?? blocks.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest)
  view.dispatch({ selection: EditorSelection.range(block.bodyFrom, block.bodyTo), userEvent: 'select.code-all' })
  view.focus()
  return true
}

function leaveCode(view: EditorView): boolean {
  const block = selectedCode(view.state)
  if (!block || view.state.readOnly || !view.state.selection.main.empty || view.state.selection.main.head !== block.bodyTo) return false
  const hasParagraph = view.state.doc.sliceString(block.to, block.to + 2) === '\n\n'
  view.dispatch({ ...(!hasParagraph ? { changes: { from: block.to, insert: '\n\n' } } : {}), selection: { anchor: block.to + 2 }, annotations: isolateHistory.of('full'), userEvent: 'input.code-exit', scrollIntoView: true })
  return true
}

function unwrapCode(view: EditorView): boolean {
  const block = selectedCode(view.state)
  if (!block || view.state.readOnly || !view.state.selection.main.empty || view.state.selection.main.head !== block.bodyFrom || view.state.doc.lineAt(block.bodyTo).number !== block.firstLine + 1) return false
  const body = view.state.doc.sliceString(block.bodyFrom, block.bodyTo)
  view.dispatch({ changes: { from: block.from, to: block.to, insert: body }, selection: { anchor: block.from }, annotations: isolateHistory.of('full'), userEvent: 'delete.code-fence' })
  return true
}

const languageWidgetCleanup = new WeakMap<HTMLElement, () => void>()

class CodeLanguageWidget extends WidgetType {
  constructor(readonly block: LiveCodeBlock, readonly readOnly: boolean, readonly display: CodeBlockDisplay, readonly locale: AppLocale) { super() }
  eq(other: CodeLanguageWidget): boolean { return this.block.from === other.block.from && this.block.to === other.block.to && this.block.opening === other.block.opening && this.block.language === other.block.language && this.readOnly === other.readOnly && this.locale === other.locale }
  toDOM(view: EditorView): HTMLElement {
    const footer = document.createElement('div')
    footer.className = 'cm-live-code-footer'
    footer.contentEditable = 'false'
    footer.dataset.sourceLine = String(this.block.lastLine)
    footer.dataset.sourceEnd = String(this.block.lastLine)
    const input = document.createElement('input')
    const t = (label: string) => translate(this.locale, label)
    input.type = 'text'; input.value = this.block.language; input.placeholder = t('选择语言'); input.readOnly = this.readOnly; input.spellcheck = false
    input.setAttribute('aria-label', t('代码块语言'))
    input.title = t('输入语言名称（如 Python、JSON、HTML、Markdown），按 Enter 或离开输入框应用')
    input.autocomplete = 'off'
    const commit = (): void => {
      const block = liveCodeBlocks(view.state).find((candidate) => candidate.from === this.block.from && candidate.opening === this.block.opening)
      if (!block || view.state.readOnly) return
      const language = codeLanguageInputValue(input.value)
      const prefix = /^( {0,3}(?:`{3,}|~{3,}))/.exec(block.opening)?.[0]
      if (!prefix || language === block.language) return
      view.dispatch({ changes: { from: block.from, to: view.state.doc.line(block.firstLine).to, insert: prefix + language }, annotations: isolateHistory.of('full'), userEvent: 'input.code-language' })
    }
    const finish = (): void => {
      const block = liveCodeBlocks(view.state).find((candidate) => candidate.from === this.block.from)
      if (block) view.dispatch({ selection: { anchor: block.bodyFrom }, userEvent: 'select.code' })
      view.focus()
    }
    const settings = document.createElement('details')
    settings.className = 'cm-code-display-settings'
    const summary = document.createElement('summary')
    summary.textContent = t('代码块显示')
    settings.append(summary)
    settings.addEventListener('toggle', () => view.requestMeasure())
    const select = (labelText: string, name: keyof CodeBlockDisplay, enabled: string, disabled: string) => {
      const label = document.createElement('label')
      label.textContent = t(labelText)
      const control = document.createElement('select')
      control.setAttribute('aria-label', t(labelText))
      for (const [value, text] of [['default', '跟随全局'], ['on', enabled], ['off', disabled]]) {
        const option = document.createElement('option'); option.value = value; option.textContent = t(text); control.append(option)
      }
      control.value = this.display[name] === undefined ? 'default' : this.display[name] ? 'on' : 'off'
      control.addEventListener('change', () => {
        const block = liveCodeBlocks(view.state).find(candidate => candidate.from === this.block.from)
        if (!block) return
        const display = { ...(view.state.field(codeBlockDisplay, false)?.get(block.from) ?? {}) }
        display[name] = control.value === 'default' ? undefined : control.value === 'on'
        view.dispatch({ effects: setCodeBlockDisplay.of({ from: block.from, display }) })
      })
      label.append(control); settings.append(label)
    }
    select('当前代码块行号', 'lineNumbers', '显示', '隐藏')
    select('当前代码块折行', 'wrapLines', '折行', '不折行')
    footer.append(settings, input)
    languageWidgetCleanup.set(footer, attachCodeLanguageSuggestions(input, () => { commit(); finish() }, this.locale))
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || !['Enter', 'Escape'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      if (event.key === 'Enter') commit(); else input.value = this.block.language
      finish()
    })
    return footer
  }
  destroy(dom: HTMLElement): void { languageWidgetCleanup.get(dom)?.(); languageWidgetCleanup.delete(dom) }
  ignoreEvent(): boolean { return true }
}

function codePreviews(state: EditorState): DecorationSet {
  const settings = state.facet(markdownOptionsFacet)
  const ranges: Range<Decoration>[] = []
  const editing = state.field(liveEditingBlock, false)
  for (const block of liveCodeBlocks(state)) {
    if (editing && block.from >= editing.from && block.to <= editing.to) continue
    ranges.push(Decoration.replace({ block: true, inclusiveStart: true, inclusiveEnd: false }).range(block.from, block.bodyFrom))
    const display = state.field(codeBlockDisplay, false)?.get(block.from) ?? {}
    const lineNumbers = display.lineNumbers ?? settings.codeLineNumbers
    const wrapLines = display.wrapLines ?? settings.codeWrapLines
    for (let number = block.firstLine + 1; number < block.lastLine; number++) {
      const edge = `${number === block.firstLine + 1 ? ' cm-live-code-first' : ''}${number === block.lastLine - 1 ? ' cm-live-code-last' : ''}`
      ranges.push(Decoration.line({ class: `cm-live-code-body${edge}${lineNumbers ? ' cm-live-code-numbered' : ''}${wrapLines ? '' : ' cm-live-code-nowrap'}`, attributes: { 'data-source-line': String(number), 'data-source-end': String(number), 'data-code-line': String(number - block.firstLine) } }).range(state.doc.line(number).from))
    }
    ranges.push(Decoration.replace({ widget: new CodeLanguageWidget(block, state.readOnly, display, state.facet(editorLocale)), block: true }).range(state.doc.line(block.lastLine).from, block.to))
  }
  return Decoration.set(ranges, true)
}

const codeDecorations = StateField.define<DecorationSet>({
  create: codePreviews,
  update: (value, transaction) => {
    const previousEditing = transaction.startState.field(liveEditingBlock, false)
    const nextEditing = transaction.state.field(liveEditingBlock, false)
    const editingChanged = previousEditing?.from !== nextEditing?.from || previousEditing?.to !== nextEditing?.to
    return transaction.docChanged || transaction.reconfigured || editingChanged || transaction.effects.some(effect => effect.is(editLiveBlock) || effect.is(setCodeBlockDisplay)) ? codePreviews(transaction.state) : value
  },
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field).update({ filter: (_from, _to, decoration) => decoration.spec.block === true }))],
})

const constrainCodePointerSelection = EditorState.transactionFilter.of(transaction => {
  if (transaction.docChanged || !transaction.selection || !transaction.isUserEvent('select.pointer')) return transaction
  const selection = transaction.selection.main
  if (selection.empty || transaction.selection.ranges.length !== 1) return transaction
  const block = liveCodeBlocks(transaction.startState).find(candidate => selection.anchor >= candidate.bodyFrom && selection.anchor <= candidate.bodyTo)
  if (!block || (selection.head >= block.bodyFrom && selection.head <= block.bodyTo)) return transaction
  const head = Math.max(block.bodyFrom, Math.min(block.bodyTo, selection.head))
  return [transaction, { selection: EditorSelection.range(selection.anchor, head) }]
})

const codeFooterPointer = ViewPlugin.fromClass(class {
  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || !(event.target instanceof Element) || event.target.closest('input,button,select,summary,details')) return
    for (const footer of this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-live-code-footer')) {
      const rect = footer.getBoundingClientRect()
      if (event.clientY < rect.top || event.clientY >= rect.bottom || event.clientX < rect.right || event.clientX > rect.right + 24) continue
      const block = liveCodeBlocks(this.view.state).find(candidate => candidate.lastLine === Number(footer.dataset.sourceLine))
      if (!block) continue
      event.preventDefault()
      event.stopPropagation()
      this.view.dispatch({ selection: { anchor: block.bodyTo }, userEvent: 'select.pointer' })
      this.view.focus()
      return
    }
  }
  constructor(readonly view: EditorView) { view.scrollDOM.addEventListener('mousedown', this.onMouseDown, true) }
  destroy(): void { this.view.scrollDOM.removeEventListener('mousedown', this.onMouseDown, true) }
})

export function liveCodeExtension(): Extension {
  return [codeDecorations, codeSelectAllPending, constrainCodePointerSelection, codeFooterPointer, Prec.high(keymap.of([
    { key: 'Enter', run: confirmCodeFence },
    { key: 'Mod-a', run: selectLiveCode },
    { key: 'Mod-Enter', run: leaveCode },
    { key: 'Backspace', run: unwrapCode },
  ]))]
}

export function autoIndentSelectedCode(view: EditorView): boolean {
  if (view.composing || view.state.readOnly || !view.state.facet(markdownOptionsFacet).codeShiftTabAutoIndent || view.state.selection.ranges.length !== 1) return false
  const { from, to } = view.state.selection.main
  const block = liveCodeBlocks(view.state).find(candidate => from >= candidate.bodyFrom && to <= candidate.bodyTo)
  if (!block) return false
  const changes = indentRange(view.state, from, to)
  if (!changes.empty) view.dispatch({ changes, userEvent: 'input.code-auto-indent', annotations: isolateHistory.of('full') })
  return true
}
