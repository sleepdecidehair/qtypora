import { Compartment, EditorState, Prec, type Extension, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

type GuardView = Pick<EditorView, 'state' | 'composing' | 'compositionStarted'> & { dispatch(spec: TransactionSpec): void }
export type CloseGuardResult = 'locked' | 'composing' | 'unavailable' | 'already-locked'
export interface EditorCloseHandle { begin(): CloseGuardResult; end(): void; readonly blocked: boolean }

/** Installed in every document state; never rebuild the document or its selection. */
export class CloseGuard {
  private readonly compartment = new Compartment()
  private active = false
  private interrupted = false
  readonly extension: Extension

  constructor(onBlockedChange: () => void) {
    this.extension = [
      Prec.highest(this.compartment.of([])),
      Prec.highest(EditorState.transactionFilter.of(transaction => {
        if (!this.active || !transaction.docChanged) return transaction
        this.interrupted = true
        // A filter must not dispatch or change React state during transaction creation.
        queueMicrotask(onBlockedChange)
        // Programmatic work may complete after the guard is installed. Preserve
        // its transaction; callers must abort closing when this flag is set.
        return transaction
      })),
    ]
  }

  get locked(): boolean { return this.active }
  get blocked(): boolean { return this.interrupted }

  begin(view: GuardView): CloseGuardResult {
    if (this.active) return 'already-locked'
    if (view.composing || view.compositionStarted) return 'composing'
    if (this.compartment.get(view.state) === undefined) return 'unavailable'
    this.interrupted = false
    this.active = true
    try {
      view.dispatch({ effects: this.compartment.reconfigure([EditorState.readOnly.of(true), EditorView.editable.of(false)]) })
    } catch (error) {
      this.active = false
      throw error
    }
    return 'locked'
  }

  end(view: GuardView): void {
    if (!this.active) return
    if (this.compartment.get(view.state) !== undefined) view.dispatch({ effects: this.compartment.reconfigure([]) } satisfies TransactionSpec)
    this.active = false
  }
}
