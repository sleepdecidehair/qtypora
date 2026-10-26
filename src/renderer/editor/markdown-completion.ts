import { supportsPreview } from './preview-budget'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import emoji from 'markdown-it-emoji/lib/data/full.mjs'
import { markdownDocumentModel, markdownOptionsFacet } from './markdown-config'
import { readFrontMatter } from './markdown-features'
import { markdownDefinitions } from './markdown-references'

const emojiCompletions = Object.entries(emoji).map(([name, glyph]) => ({ label: `:${name}:`, detail: glyph, type: 'text', apply: `:${name}:` }))

export function markdownCompletionSource(context: CompletionContext): CompletionResult | null {
  if (context.state.readOnly || !supportsPreview(context.state)) return null
  let node = syntaxTree(context.state).resolveInner(context.pos, -1)
  for (;;) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'URL', 'Autolink', 'HTMLTag', 'HTMLBlock'].includes(node.name)) return null
    if (!node.parent) break
    node = node.parent
  }
  const options = context.state.facet(markdownOptionsFacet)
  if (options.frontMatter) {
    const matter = readFrontMatter(context.state.doc.toString())
    if (matter && context.state.doc.lineAt(context.pos).number <= matter.endLine) return null
  }
  const shortcode = context.matchBefore(/:[\w+-]{1,40}/)
  if (options.emoji && shortcode && (shortcode.from === 0 || !/[\w:/\\]/.test(context.state.doc.sliceString(shortcode.from - 1, shortcode.from)))) {
    return { from: shortcode.from, to: context.state.doc.sliceString(context.pos, context.pos + 1) === ':' ? context.pos + 1 : context.pos, options: emojiCompletions, validFor: /^:[\w+-]*:?$/ }
  }
  const label = context.matchBefore(/\[\^?[^\[\]\n]{0,80}/)
  if (!label) return null
  const isFootnote = label.text.startsWith('[^')
  if (isFootnote && !options.footnotes) return null
  const definitions = markdownDefinitions(markdownDocumentModel(context.state).environment).filter(definition => definition.kind === (isFootnote ? 'footnote' : 'reference'))
  const unique = Array.from(new Set(definitions.map(definition => definition.label)))
  if (!unique.length) return null
  return {
    from: label.from,
    to: context.state.doc.sliceString(context.pos, context.pos + 1) === ']' ? context.pos + 1 : context.pos,
    options: unique.map(value => ({ label: `[${isFootnote ? '^' : ''}${value}]`, type: 'text', detail: isFootnote ? '脚注' : '引用链接' })),
    validFor: /^\[\^?[^\[\]\n]*\]?$/,
  }
}

export const markdownCompletionExtension = [autocompletion({ override: [markdownCompletionSource], activateOnTyping: true, maxRenderedOptions: 30, defaultKeymap: false }), Prec.high(keymap.of(completionKeymap))]
