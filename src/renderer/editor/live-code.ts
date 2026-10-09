import { EditorSelection, Prec, StateField, type EditorState, type Extension, type Range, type TransactionSpec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view'
import { editLiveBlock, liveEditingBlock } from './live-blocks'
import { attachCodeLanguageSuggestions } from './code-language-suggestions'
import { codeLanguageInputValue } from './code-languages'

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

export function liveCodeBlocks(state: EditorState): LiveCodeBlock[] {
  const blocks: LiveCodeBlock[] = []
  if (state.doc.length > 200000) return blocks
  syntaxTree(state).iterate({ enter: (node) => {
    if (node.name !== 'FencedCode') return
    if (node.node.parent?.name !== 'Document') return false
    const marks = node.node.getChildren('CodeMark')
    if (marks.length !== 2) return false
    const first = state.doc.lineAt(marks[0].from)
    const last = state.doc.lineAt(marks[1].from)
    const language = node.node.getChild('CodeInfo')
    const info = language ? state.doc.sliceString(language.from, language.to).trim() : ''
    if (info.split(/\s+/)[0].toLowerCase() === 'mermaid' || last.number <= first.number + 1) return false
    blocks.push({ from: first.from, to: last.to, bodyFrom: first.to + 1, bodyTo: last.from - 1, firstLine: first.number, lastLine: last.number, opening: first.text, language: info })
    return false
  } })
  return blocks
}

export function fenceCreation(state: EditorState): TransactionSpec | null {
  const selection = state.selection.main
  if (state.readOnly || state.doc.length > 200000 || state.selection.ranges.length !== 1 || !selection.empty) return null
  const line = state.doc.lineAt(selection.head)
  const match = /^( {0,3})(`{3,})([^`\n]*)$/.exec(line.text)
  if (!match || selection.head !== line.to) return null
  let node = syntaxTree(state).resolveInner(selection.head, -1)
  while (node.parent && node.name !== 'FencedCode') node = node.parent
  if (node.name !== 'FencedCode' || node.parent?.name !== 'Document' || state.doc.lineAt(node.from).number !== line.number || node.getChildren('CodeMark').length > 1) return null
  const insert = `\n\n${match[1]}${match[2]}`
  return {
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + 1),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.code-fence',
    scrollIntoView: true,
    ...(match[3].trim().toLowerCase() === 'mermaid' ? { effects: editLiveBlock.of({ from: line.from, to: line.to + insert.length }) } : {}),
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

export function selectLiveCode(view: EditorView): boolean {
  const block = selectedCode(view.state)
  if (!block) return false
  view.dispatch({ selection: EditorSelection.range(block.bodyFrom, block.bodyTo), userEvent: 'select.code' })
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
  constructor(readonly block: LiveCodeBlock, readonly readOnly: boolean) { super() }
  eq(other: CodeLanguageWidget): boolean { return this.block.from === other.block.from && this.block.to === other.block.to && this.block.language === other.block.language && this.readOnly === other.readOnly }
  toDOM(view: EditorView): HTMLElement {
    const footer = document.createElement('div')
    footer.className = 'cm-live-code-footer'
    footer.contentEditable = 'false'
    footer.dataset.sourceLine = String(this.block.lastLine)
    footer.dataset.sourceEnd = String(this.block.lastLine)
    const input = document.createElement('input')
    input.type = 'text'; input.value = this.block.language; input.placeholder = '选择语言'; input.readOnly = this.readOnly; input.spellcheck = false
    input.setAttribute('aria-label', '代码块语言')
    input.title = '输入语言名称（如 Python、JSON、HTML、Markdown），按 Enter 或离开输入框应用'
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
    footer.append(input)
    languageWidgetCleanup.set(footer, attachCodeLanguageSuggestions(input, () => { commit(); finish() }))
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
  const ranges: Range<Decoration>[] = []
  const editing = state.field(liveEditingBlock, false)
  for (const block of liveCodeBlocks(state)) {
    if (editing && block.from >= editing.from && block.to <= editing.to) continue
    ranges.push(Decoration.replace({ block: true, inclusiveStart: true, inclusiveEnd: false }).range(block.from, block.bodyFrom))
    for (let number = block.firstLine + 1; number < block.lastLine; number++) {
      const edge = `${number === block.firstLine + 1 ? ' cm-live-code-first' : ''}${number === block.lastLine - 1 ? ' cm-live-code-last' : ''}`
      ranges.push(Decoration.line({ class: `cm-live-code-body${edge}`, attributes: { 'data-source-line': String(number), 'data-source-end': String(number) } }).range(state.doc.line(number).from))
    }
    ranges.push(Decoration.replace({ widget: new CodeLanguageWidget(block, state.readOnly), block: true }).range(state.doc.line(block.lastLine).from, block.to))
  }
  return Decoration.set(ranges, true)
}

const codeDecorations = StateField.define<DecorationSet>({
  create: codePreviews,
  update: (value, transaction) => {
    const previousEditing = transaction.startState.field(liveEditingBlock, false)
    const nextEditing = transaction.state.field(liveEditingBlock, false)
    const editingChanged = previousEditing?.from !== nextEditing?.from || previousEditing?.to !== nextEditing?.to
    return transaction.docChanged || transaction.reconfigured || editingChanged || transaction.effects.some(effect => effect.is(editLiveBlock)) ? codePreviews(transaction.state) : value
  },
  provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field).update({ filter: (_from, _to, decoration) => decoration.spec.block === true }))],
})

export function liveCodeExtension(): Extension {
  return [codeDecorations, Prec.high(keymap.of([
    { key: 'Enter', run: confirmCodeFence },
    { key: 'Mod-a', run: selectLiveCode },
    { key: 'Mod-Enter', run: leaveCode },
    { key: 'Backspace', run: unwrapCode },
  ]))]
}
