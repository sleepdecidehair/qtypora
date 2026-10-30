import type { EditorAction } from './types'

export interface TextEdit {
  from: number
  to: number
  insert: string
  selection: { anchor: number; head: number }
}

function editLines(text: string, from: number, to: number, transform: (selectedLines: string[]) => string[]): TextEdit {
  const start = from === 0 ? 0 : text.lastIndexOf('\n', from - 1) + 1
  const selectionEnd = to > from && text[to - 1] === '\n' ? to - 1 : to
  const endBreak = text.indexOf('\n', selectionEnd)
  const end = endBreak === -1 ? text.length : endBreak
  const selectedLines = text.slice(start, end).split('\n')
  const insert = transform(selectedLines).join('\n')
  return { from: start, to: end, insert, selection: { anchor: start, head: start + insert.length } }
}

function lines(text: string, from: number, to: number, prefix: string | ((index: number) => string)): TextEdit {
  return editLines(text, from, to, selectedLines => selectedLines.map((line, index) => {
    const stripped = line.replace(/^(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
    return (typeof prefix === 'function' ? prefix(index) : prefix) + stripped
  }))
}

function toggleQuote(text: string, from: number, to: number): TextEdit {
  const marker = /^( {0,3})>[ \t]?/
  return editLines(text, from, to, selectedLines => {
    const remove = selectedLines.some(line => marker.test(line))
      && selectedLines.every(line => marker.test(line) || line.trim() === '')
    return selectedLines.map(line => remove
      ? line.replace(marker, '$1')
      : marker.test(line) ? line : '> ' + line)
  })
}

function insertBlock(text: string, from: number, to: number, body: string, selectionOffset?: number): TextEdit {
  const before = from > 0 && text[from - 1] !== '\n' ? '\n\n' : ''
  const after = to < text.length && text[to] !== '\n' ? '\n\n' : '\n'
  const insert = before + body + after
  const anchor = from + before.length + (selectionOffset ?? body.length)
  return { from, to, insert, selection: { anchor, head: anchor } }
}

export function createTextEdit(action: EditorAction, text: string, from: number, to: number, value?: string): TextEdit | null {
  const start = Math.max(0, Math.min(from, to, text.length))
  const end = Math.max(start, Math.min(Math.max(from, to), text.length))
  switch (action) {
    case 'image': {
      const insert = value || '![图片说明](image.png)'
      return { from: start, to: end, insert, selection: { anchor: start + insert.length, head: start + insert.length } }
    }
    case 'heading-1': case 'heading-2': case 'heading-3': case 'heading-4': case 'heading-5': case 'heading-6':
      return lines(text, start, end, '#'.repeat(Number(action.slice(-1))) + ' ')
    case 'paragraph': return lines(text, start, end, '')
    case 'quote': return toggleQuote(text, start, end)
    case 'bullet-list': return lines(text, start, end, '- ')
    case 'ordered-list': return lines(text, start, end, (index) => `${index + 1}. `)
    case 'task-list': return lines(text, start, end, '- [ ] ')
    case 'code': {
      const selected = text.slice(start, end)
      const maxFence = Math.max(2, ...Array.from(selected.matchAll(/`+/g), (match) => match[0].length))
      const fence = '`'.repeat(maxFence + 1)
      const language = value && /^[\w+#.-]{1,40}$/.test(value) ? value : ''
      return insertBlock(text, start, end, `${fence}${language}\n${selected || '代码'}\n${fence}`, fence.length + language.length + 1)
    }
    case 'math': return insertBlock(text, start, end, `$$\n${text.slice(start, end) || 'E = mc^2'}\n$$`, 3)
    case 'table': return insertBlock(text, start, end, '| 标题 | 标题 |\n| --- | --- |\n| 内容 | 内容 |')
    case 'rule': return insertBlock(text, start, end, '---')
    default: return null
  }
}
