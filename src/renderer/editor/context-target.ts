import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { ContextMenuKind } from '../../shared/contracts'
import { markdownParser } from './markdown'
import { parseTableSource } from './table-model'

export interface ContextTarget {
  kind: Extract<ContextMenuKind, 'editor' | 'table' | 'code' | 'math' | 'diagram' | 'image' | 'link'>
  from: number
  to: number
  source: string
  body?: { from: number; to: number; text: string }
  address?: { from: number; to: number; value: string }
  row?: number
  column?: number
}

export function sourceContextTarget(state: EditorState, position: number): ContextTarget {
  const pos = Math.max(0, Math.min(state.doc.length, position))
  let node = syntaxTree(state).resolveInner(pos, 1)
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
    }
    node = node.parent
  }
  // Token maps preserve canonical source offsets; no rich-text serialization is involved.
  if (state.doc.length <= 200000) {
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
        return { kind: token.type === 'math_block' ? 'math' : fenced && token.info.trim().split(/\s+/)[0] === 'mermaid' ? 'diagram' : 'code', from, to, source, body: { from: from + start, to: from + end, text: source.slice(start, end) } }
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

export function imageContextTarget(state: EditorState, source: string, from: number, to: number): ContextTarget | null {
  let match: ContextTarget | null = null
  syntaxTree(state).iterate({ from, to, enter: (node) => {
    if (match || node.name !== 'Image') return
    const url = node.node.getChild('URL')
    if (!url) return
    const candidate = sourceContextTarget(state, url.from)
    if (candidate.kind === 'image' && candidate.address?.value === source) match = candidate
  } })
  if (!match) {
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
