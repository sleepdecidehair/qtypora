import type { MarkdownOptions } from '../../shared/markdown-options'
import { getMarkdownParser } from './markdown'
import type { ContextTarget } from './context-target'

export interface ImageSize { width: number | null; height: number | null; alignment?: 'left' | 'center' | 'right' | 'auto' }
const htmlEscape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function currentImageSize(source: string): ImageSize {
  const dimension = (name: string) => {
    const match = source.match(new RegExp(`\\s${name}\\s*=\\s*(?:"(\\d+)"|'(\\d+)'|(\\d+))`, 'i'))
    const value = Number(match?.[1] ?? match?.[2] ?? match?.[3])
    return Number.isInteger(value) && value >= 1 && value <= 10000 ? value : null
  }
  const alignment = source.match(/\salign\s*=\s*(?:"(left|center|right)"|'(left|center|right)'|(left|center|right)(?=\s|>))/i)
  return { width: dimension('width'), height: dimension('height'), ...(alignment ? { alignment: (alignment[1] || alignment[2] || alignment[3]).toLowerCase() as 'left' | 'center' | 'right' } : {}) }
}

export function imageSizeEdit(target: ContextTarget, size: ImageSize, options?: MarkdownOptions): { from: number; to: number; insert: string } | null {
  if (target.kind !== 'image' || !target.address) return null
  for (const dimension of [size.width, size.height]) if (dimension !== null && (!Number.isInteger(dimension) || dimension < 1 || dimension > 10000)) throw new Error('图片尺寸必须为 1–10000 的整数，留空表示自动。')
  if (size.alignment && !['left', 'center', 'right', 'auto'].includes(size.alignment)) throw new Error('图片对齐方式无效。')
  let source = target.source
  if (/^<img\b/i.test(source)) {
    for (const name of ['width', 'height'] as const) {
      const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'gi')
      source = source.replace(pattern, '')
      if (size[name] !== null) source = source.replace(/\s*\/?\s*>$/, ` ${name}="${size[name]}">`)
    }
  } else {
    if (size.width === null && size.height === null && (!size.alignment || size.alignment === 'auto')) return null
    const parser = getMarkdownParser(options)
    const tokens = parser.parseInline(source, {})
    const image = tokens.flatMap(token => token.children || []).find(token => token.type === 'image')
    if (!image && !target.imageText) return null
    const alt = target.imageText?.alt ?? parser.renderer.renderInlineAsText(image?.children || [], parser.options, {})
    const title = target.imageText?.title ?? image?.attrGet('title') ?? ''
    source = `<img src="${htmlEscape(target.address.value)}" alt="${htmlEscape(alt)}"${title ? ` title="${htmlEscape(title)}"` : ''}${size.width === null ? '' : ` width="${size.width}"`}${size.height === null ? '' : ` height="${size.height}"`}>`
  }
  if (size.alignment) {
    source = source.replace(/\salign\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    if (size.alignment !== 'auto') source = source.replace(/\s*\/?\s*>$/, ` align="${size.alignment}">`)
  }
  return source === target.source ? null : { from: target.from, to: target.to, insert: source }
}

export function chooseImageSize(initial: ImageSize): Promise<ImageSize | null> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog')
    dialog.className = 'cm-image-size-dialog'
    dialog.setAttribute('aria-label', '图片尺寸')
    const heading = document.createElement('h2'); heading.textContent = '图片尺寸'
    const description = document.createElement('p'); description.textContent = '填写显示像素，留空自动计算。原始图片文件不变。'
    dialog.append(heading, description)
    const inputs = new Map<'width' | 'height', HTMLInputElement>()
    for (const [name, label] of [['width', '宽度'], ['height', '高度']] as const) {
      const row = document.createElement('label'); row.textContent = label
      const input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '10000'
      input.setAttribute('aria-label', `图片${label}`); input.value = initial[name] === null ? '' : String(initial[name]); input.placeholder = '自动'
      row.append(input); inputs.set(name, input); dialog.append(row)
    }
    const alignmentLabel = document.createElement('label'); alignmentLabel.textContent = '对齐'
    const alignment = document.createElement('select'); alignment.setAttribute('aria-label', '图片对齐')
    for (const [value, label] of [['auto', '跟随段落'], ['left', '靠左'], ['center', '居中'], ['right', '靠右']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; alignment.append(option)
    }
    alignment.value = initial.alignment ?? 'auto'; alignmentLabel.append(alignment); dialog.append(alignmentLabel)
    const error = document.createElement('p'); error.setAttribute('role', 'alert')
    const actions = document.createElement('div'); actions.className = 'cm-image-size-actions'
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'
    const save = document.createElement('button'); save.type = 'button'; save.textContent = '应用尺寸'
    actions.append(cancel, save); dialog.append(error, actions)
    let result: ImageSize | null = null
    cancel.addEventListener('click', () => dialog.close())
    const submit = () => {
      const width = inputs.get('width')!, height = inputs.get('height')!
      const dimensions = { width: width.value === '' ? null : Number(width.value), height: height.value === '' ? null : Number(height.value) }
      if (!width.checkValidity() || !height.checkValidity() || Object.values(dimensions).some(value => value !== null && !Number.isInteger(value))) { error.textContent = '请输入 1–10000 的整数，或留空使用自动尺寸。'; return }
      result = { ...dimensions, alignment: alignment.value as ImageSize['alignment'] }; dialog.close()
    }
    save.addEventListener('click', submit)
    dialog.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); submit() } })
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result) }, { once: true })
    document.body.append(dialog); dialog.showModal(); inputs.get('width')!.focus()
  })
}
