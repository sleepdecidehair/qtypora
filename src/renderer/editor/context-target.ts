import type { EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { ensureSyntaxTree } from '@codemirror/language'
import type { ContextMenuKind } from '../../shared/contracts'
import { getMarkdownParser } from './markdown'
import { markdownOptionsFacet } from './markdown-config'
import { parseTableSource } from './table-model'

export interface ContextTarget {
  kind: Extract<ContextMenuKind, 'editor' | 'table' | 'code' | 'math' | 'diagram' | 'image' | 'link'>
  from: number
  to: number
  source: string
  body?: { from: number; to: number; text: string }
  address?: { from: number; to: number; value: string }
  imageText?: { alt: string; title: string }
  row?: number
  column?: number
}

function referenceImageTarget(state: EditorState, node: SyntaxNode, tree: Tree): ContextTarget | null {
  const parser = getMarkdownParser(state.facet(markdownOptionsFacet))
  const source = state.doc.sliceString(node.from, node.to)
  const label = node.getChild('LinkLabel')
  const explicit = label ? state.doc.sliceString(label.from + 1, label.to - 1) : ''
  const implicit = source.match(/^!\[((?:\\.|[^\]])*)\]/)?.[1] || ''
  const normalize = (value: string) => parser.utils.unescapeAll(value).trim().replace(/\s+/g, ' ').toUpperCase()
  const key = normalize(explicit || implicit)
  let address: ContextTarget['address']
  tree.iterate({ enter(definition) {
    if (address || definition.name !== 'LinkReference') return
    const name = definition.node.getChild('LinkLabel'), url = definition.node.getChild('URL')
    if (!name || !url || normalize(state.doc.sliceString(name.from + 1, name.to - 1)) !== key) return
    let from = url.from, to = url.to
    if (state.doc.sliceString(from, from + 1) === '<') { from++; to-- }
    address = { from, to, value: parser.normalizeLink(parser.utils.unescapeAll(state.doc.sliceString(from, to))) }
  } })
  if (!address) return null
  const environment = {}
  parser.parse(state.doc.toString(), environment)
  const image = parser.parseInline(source, environment).flatMap(token => token.children || []).find(token => token.type === 'image')
  if (!image) return null
  return { kind: 'image', from: node.from, to: node.to, source, address, imageText: { alt: parser.renderer.renderInlineAsText(image.children || [], parser.options, environment), title: image.attrGet('title') || '' } }
}

function referenceLinkTarget(state: EditorState, node: SyntaxNode): ContextTarget | null {
  // Parsing is bounded as in the block-context fallback. The Markdown parser
  // resolves duplicate, escaped and implicit reference labels authoritatively.
  if (state.doc.length > 200000) return null
  const parser = getMarkdownParser(state.facet(markdownOptionsFacet))
  const source = state.doc.sliceString(node.from, node.to)
  const environment = {}
  parser.parse(state.doc.toString(), environment)
  const children = parser.parseInline(source, environment).flatMap(token => token.children || [])
  const link = children[0]?.type === 'link_open' && children.at(-1)?.type === 'link_close' ? children[0] : null
  const href = link?.attrGet('href')
  if (href == null) return null
  // Link menu operations only read value; never edit a shared definition.
  return { kind: 'link', from: node.from, to: node.to, source, address: { from: node.from, to: node.to, value: href } }
}

export function sourceContextTarget(state: EditorState, position: number, tree?: Tree): ContextTarget {
  const pos = Math.max(0, Math.min(state.doc.length, position))
  const completeTree = tree ?? ensureSyntaxTree(state, state.doc.length, 50)
  if (!completeTree) {
    const line = state.doc.lineAt(pos)
    return { kind: 'editor', from: line.from, to: line.to, source: line.text }
  }
  let node = completeTree.resolveInner(pos, 1)
  while (node.parent) {
    if (node.name === 'InlineCode') {
      const source = state.doc.sliceString(node.from, node.to)
      const marker = source.match(/^`+/)?.[0].length || 1
      return { kind: 'code', from: node.from, to: node.to, source, body: { from: node.from + marker, to: node.to - marker, text: source.slice(marker, -marker) } }
    }
    if (node.name === 'Image' || node.name === 'Link') {
      const url = node.getChild('URL')
      if (url) {
        let from = url.from, to = url.to
        if (state.doc.sliceString(from, from + 1) === '<') { from++; to-- }
        return { kind: node.name === 'Image' ? 'image' : 'link', from: node.from, to: node.to, source: state.doc.sliceString(node.from, node.to), address: { from, to, value: state.doc.sliceString(from, to).replace(/\\([\\() ])/g, '$1') } }
      }
      if (node.name === 'Image') {
        const reference = referenceImageTarget(state, node, completeTree)
        if (reference) return reference
      }
      if (node.name === 'Link') {
        const reference = referenceLinkTarget(state, node)
        if (reference) return reference
      }
    }
    node = node.parent
  }
  // Token maps preserve canonical source offsets; no rich-text serialization is involved.
  if (state.doc.length <= 200000) {
    const markdownParser = getMarkdownParser(state.facet(markdownOptionsFacet))
    for (const token of markdownParser.parse(state.doc.toString(), {})) {
      if (!token.map || token.nesting === -1) continue
      const from = state.doc.line(token.map[0] + 1).from
      const to = state.doc.line(Math.min(token.map[1], state.doc.lines)).to
      if (pos < from || pos > to) continue
      if (token.type === 'table_open') {
        const source = state.doc.sliceString(from, to)
        const model = parseTableSource(source, from, token.map[0] + 1)
        const cell = model.cells.find((item) => pos >= item.from && pos <= item.to) || model.cells.find((item) => item.line === state.doc.lineAt(pos).number) || model.cells[0]
        return { kind: 'table', from, to, source, row: cell?.row || 0, column: cell?.column || 0 }
      }
      if (token.type === 'fence' || token.type === 'code_block' || token.type === 'math_block') {
        const source = state.doc.sliceString(from, to)
        const fenced = token.type === 'fence'
        const start = fenced ? source.indexOf('\n') + 1 : token.type === 'math_block' ? source.indexOf('$$') + 2 : 0
        const firstFence = source.match(/^\s{0,3}(`{3,}|~{3,})/)
        const lastLine = source.slice(source.lastIndexOf('\n') + 1)
        const isClosedFence = fenced && firstFence && new RegExp(`^\\s{0,3}${firstFence[1][0]}{${firstFence[1].length},}\\s*$`).test(lastLine) && source.includes('\n')
        const closing = isClosedFence ? source.lastIndexOf('\n') : token.type === 'math_block' ? source.lastIndexOf('$$') : source.length
        const end = Math.max(start, closing)
        return { kind: token.type === 'math_block' ? 'math' : fenced && ['mermaid', 'sequence', 'flow'].includes(token.info.trim().split(/\s+/)[0]) ? 'diagram' : 'code', from, to, source, body: { from: from + start, to: from + end, text: source.slice(start, end) } }
      }
    }
  }
  const line = state.doc.lineAt(pos)
  for (const match of line.text.matchAll(/(?<!\\)\$(?!\$)(\S(?:[^$\n]*?\S)?)\$(?!\$)/g)) {
    const from = line.from + match.index, to = from + match[0].length
    if (pos >= from && pos <= to) return { kind: 'math', from, to, source: match[0], body: { from: from + 1, to: to - 1, text: match[1] } }
  }
  return { kind: 'editor', from: line.from, to: line.to, source: line.text }
}

export function contextTargetUnchanged(target: ContextTarget, content: string): boolean {
  return target.from >= 0 && target.to <= content.length && content.slice(target.from, target.to) === target.source
}

export function contextObjectSource(target: ContextTarget): string { return target.body?.text ?? target.source }

/** Match every rendered cell link before trusting a clicked link's ordinal. */
export function tableLinkContextTarget(state: EditorState, from: number, to: number, hrefs: string[], index: number): ContextTarget | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > state.doc.length || from > to || !Number.isInteger(index) || index < 0 || index >= hrefs.length) return null
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const targets: ContextTarget[] = []
  tree.iterate({ from, to, enter(node) {
    if (node.name !== 'Link' || node.from < from || node.to > to) return
    const target = sourceContextTarget(state, node.from + 1, tree)
    if (target.kind === 'link' && target.from === node.from && target.to === node.to && target.address) targets.push(target)
  } })
  if (targets.length !== hrefs.length) return null
  const parser = getMarkdownParser(state.facet(markdownOptionsFacet))
  const normalize = (value: string) => parser.normalizeLink(parser.utils.unescapeAll(value))
  if (targets.some((target, i) => normalize(target.address!.value) !== normalize(hrefs[i]))) return null
  return targets[index]
}

export function imageContextTarget(state: EditorState, source: string, from: number, to: number): ContextTarget | null {
  let match: ContextTarget | null = null
  // Reference definitions may be after the visible image. A published tree can be
  // partial under load, so resolve against one bounded complete snapshot.
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return null
  const parser = getMarkdownParser(state.facet(markdownOptionsFacet))
  const normalize = (value: string) => parser.normalizeLink(parser.utils.unescapeAll(value))
  tree.iterate({ from, to, enter: (node) => {
    if (match || node.name !== 'Image') return
    const candidate = sourceContextTarget(state, node.from + 2, tree)
    if (candidate.kind === 'image' && candidate.address && normalize(candidate.address.value) === normalize(source)) match = candidate
  } })
  if (!match) {
    const markdownParser = getMarkdownParser(state.facet(markdownOptionsFacet))
    const section = state.doc.sliceString(from, to)
    for (const tag of section.matchAll(/<img\b[^>]*>/gi)) {
      const attribute = tag[0].match(/\bsrc\s*=\s*(["'])(.*?)\1/i)
      if (!attribute || markdownParser.utils.unescapeAll(attribute[2]) !== source) continue
      const start = from + tag.index
      const urlFrom = start + attribute.index! + attribute[0].indexOf(attribute[1]) + 1
      match = { kind: 'image', from: start, to: start + tag[0].length, source: tag[0], address: { from: urlFrom, to: urlFrom + attribute[2].length, value: source } }
      break
    }
  }
  return match
}

export function isLocalResource(source: string): boolean {
  return Boolean(source) && !/^(?:https?:|data:|blob:|qtypora-media:)/i.test(source)
}
