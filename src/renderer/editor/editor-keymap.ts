import { defaultKeymap, toggleBlockComment, toggleComment } from '@codemirror/commands'
import type { KeyBinding } from '@codemirror/view'

// App owns Ctrl+/ source-mode switching; CM's comment actions would mutate Markdown first.
export const editorDefaultKeymap: readonly KeyBinding[] = defaultKeymap.filter((binding) => binding.run !== toggleComment && binding.run !== toggleBlockComment)
