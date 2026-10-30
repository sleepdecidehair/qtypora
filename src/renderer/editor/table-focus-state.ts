import type { Text } from '@codemirror/state'

export interface TableFocusState { source: Text; tableFrom: number; row: number; column: number; anchor: number; focus: number }

/** Never apply an old cell identity to a different document state. */
export function resolveTableFocusSelection(snapshot: TableFocusState, current: Text, textLength: number | null): { target: 'text' | 'cell'; anchor: number; focus: number } | null {
  if (!snapshot.source.eq(current)) return null
  if (textLength === null) return snapshot.anchor === 0 && snapshot.focus === 0 ? { target: 'cell', anchor: 0, focus: 0 } : null
  return { target: 'text', anchor: Math.max(0, Math.min(textLength, snapshot.anchor)), focus: Math.max(0, Math.min(textLength, snapshot.focus)) }
}
