import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import type { MarkdownEditorProps } from './types'
import { getMarkdownParser } from './markdown-parser'
import { markdownOptionsFacet } from './markdown-config'
import { isLocalResource } from './context-target'
import { isSafeDataImage } from '../../shared/data-image'

export interface ImageAddressRange { from: number; to: number; source: string; html: boolean }

export function imageAddressRanges(state: EditorState, includeRemote = false): ImageAddressRange[] {
  const parser = getMarkdownParser(state.facet(markdownOptionsFacet))
  const normalizeLabel = (text: string) => parser.utils.unescapeAll(text).trim().replace(/\s+/g, ' ').toUpperCase()
  const normalizeSource = (text: string) => parser.normalizeLink(parser.utils.unescapeAll(text))
  const ranges: ImageAddressRange[] = []
  const labels = new Set<string>()
  const definitions = new Map<string, ImageAddressRange>()
  const content = state.doc.toString()
  const frontMatter = content.match(/^---\n[\s\S]*?\n(?:---|\.\.\.)\s*(?:\n|$)/)?.[0].length ?? 0
  syntaxTree(state).iterate({ enter(node) {
    if (node.to <= frontMatter || ['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) return false
    if (node.name === 'Image') {
      const url = node.node.getChild('URL')
      if (url) {
        let from = url.from, to = url.to
        if (state.doc.sliceString(from, from + 1) === '<') { from++; to-- }
        ranges.push({ from, to, source: normalizeSource(state.doc.sliceString(from, to)), html: false })
      } else {
        const label = node.node.getChild('LinkLabel')
        const explicit = label ? state.doc.sliceString(label.from + 1, label.to - 1) : ''
        const implicit = state.doc.sliceString(node.from, node.to).match(/^!\[((?:\\.|[^\]])*)\]/)?.[1] || ''
        labels.add(normalizeLabel(explicit || implicit))
      }
    }
    if (node.name === 'LinkReference') {
      const label = node.node.getChild('LinkLabel'), url = node.node.getChild('URL')
      if (label && url) {
        const key = normalizeLabel(state.doc.sliceString(label.from + 1, label.to - 1))
        let from = url.from, to = url.to
        if (state.doc.sliceString(from, from + 1) === '<') { from++; to-- }
        if (!definitions.has(key)) definitions.set(key, { from, to, source: normalizeSource(state.doc.sliceString(from, to)), html: false })
      }
    }
    if (node.name === 'HTMLBlock' || node.name === 'HTMLTag') {
      const html = state.doc.sliceString(node.from, node.to).replace(/<!--[\s\S]*?-->/g, value => ' '.repeat(value.length))
      for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
        const attribute = tag[0].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
        if (!attribute) continue
        const value = attribute[1] ?? attribute[2] ?? attribute[3]
        const valueAt = attribute[0].indexOf('=') + 1
        const suffix = attribute[0].slice(valueAt)
        const padding = suffix.match(/^\s*["']?/)?.[0].length || 0
        const from = node.from + tag.index + attribute.index! + valueAt + padding
        ranges.push({ from, to: from + value.length, source: normalizeSource(value), html: true })
      }
      return false
    }
    return undefined
  } })
  for (const label of labels) {
    const definition = definitions.get(label)
    if (definition) ranges.push(definition)
  }
  return ranges.filter(range => isLocalResource(range.source) || (includeRemote && (/^https?:\/\//i.test(range.source) || isSafeDataImage(range.source)))).sort((a, b) => a.from - b.from)
}

async function updateDocumentImages(view: EditorView, getProps: () => MarkdownEditorProps, operation: 'upload' | 'organize'): Promise<void> {
  const props = getProps()
  if (view.state.readOnly || props.readOnly) return
  const original = view.state.doc
  const ranges = imageAddressRanges(view.state, operation === 'organize')
  const sources = [...new Set(ranges.map(range => range.source))]
  if (!sources.length) throw new Error('当前文档没有可处理的图片引用。')
  if (sources.length > 20) throw new Error('单次最多处理 20 张不同的图片，请分批处理。')
  const request = { id: props.documentId, revision: props.revision, content: original.toString(), sources }
  const result = operation === 'upload' ? await props.desktopApi.uploadImages(request) : await props.desktopApi.organizeImages(request)
  if (!result.ok) throw new Error(result.error.message)
  if (!result.data) return
  const current = getProps()
  if (!view.dom.isConnected || view.state.readOnly || current.readOnly || current.documentId !== props.documentId || current.revision !== props.revision || !view.state.doc.eq(original)) throw new Error('文档已改变，未替换原文图片引用。')
  const replacements = new Map(result.data.replacements.map(replacement => [replacement.source, replacement.url]))
  const changes = ranges.flatMap(range => {
    const replacement = replacements.get(range.source)
    if (!replacement) return []
    const insert = range.html ? replacement.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : replacement.replace(/[()]/g, character => character === '(' ? '%28' : '%29')
    return original.sliceString(range.from, range.to) === insert ? [] : [{ from: range.from, to: range.to, insert }]
  })
  if (changes.length) view.dispatch({ changes, userEvent: `input.image-${operation}`, annotations: isolateHistory.of('full') })
}

export function uploadDocumentImages(view: EditorView, getProps: () => MarkdownEditorProps): Promise<void> { return updateDocumentImages(view, getProps, 'upload') }
export function organizeDocumentImages(view: EditorView, getProps: () => MarkdownEditorProps): Promise<void> { return updateDocumentImages(view, getProps, 'organize') }
