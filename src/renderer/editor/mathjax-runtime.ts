import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import { SerializedMmlVisitor } from '@mathjax/src/js/core/MmlTree/SerializedMmlVisitor.js'
import { STATE } from '@mathjax/src/js/core/MathItem.js'
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js'
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js'
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js'
import '@mathjax/src/js/input/tex/begingroup/BegingroupConfiguration.js'
import '@mathjax/src/js/input/tex/bboldx/BboldxConfiguration.js'
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js'
import type { MathExpression } from './markdown-features'

RegisterHTMLHandler(liteAdaptor())
const packages = ['base', 'ams', 'newcommand', 'noundefined', 'physics', 'mhchem', 'begingroup', 'bboldx', 'textmacros']
const visitor = new SerializedMmlVisitor()
const MAX_CACHE_CHARACTERS = 2 * 1024 * 1024
const cache = new Map<string, { output?: string[]; error?: Error; size: number }>()
let cachedCharacters = 0

function cacheResult(key: string, result: { output?: string[]; error?: Error; size: number }): void {
  while (cache.size && (cache.size >= 8 || cachedCharacters + result.size > MAX_CACHE_CHARACTERS)) {
    const oldest = cache.keys().next().value!
    cachedCharacters -= cache.get(oldest)!.size
    cache.delete(oldest)
  }
  cache.set(key, result)
  cachedCharacters += result.size
}

function converter(numbering: boolean, ignoreDuplicateLabels = false) {
  const input = new TeX({ packages, tags: numbering ? 'all' : 'ams', ignoreDuplicateLabels, maxBuffer: 8192, maxMacros: 1000 })
  const document = mathjax.document('', { InputJax: input })
  return { input, convert: (expression: Pick<MathExpression, 'source' | 'display'>): string => {
    if (expression.source.length > 8192) throw new Error('公式超过 8192 字符，保留源码')
    return visitor.visitTree(document.convert(expression.source, { display: expression.display, end: STATE.CONVERT }))
  } }
}

// Each conversion owns its macro and label state; editing one document cannot affect another.
export function renderMathSequence(expressions: readonly MathExpression[], numbering: boolean): string[] {
  if (expressions.length > 500 || expressions.reduce((size, expression) => size + expression.source.length, 0) > 200000) throw new Error('公式数量或总长度超过显示上限，请拆分文档。')
  const key = JSON.stringify([numbering, expressions.map(({ source, display }) => [source, display])])
  const previous = cache.get(key)
  if (previous?.error) throw previous.error
  if (previous?.output) return previous.output
  try {
    let characters = key.length
    const bounded = (convert: (expression: MathExpression) => string, expression: MathExpression): string => {
      const result = convert(expression)
      characters += result.length
      if (characters > MAX_CACHE_CHARACTERS) throw new Error('公式渲染结果超过 2 MB，保留源码，请拆分文档。')
      return result
    }
    const first = converter(numbering)
    const initial = expressions.map(expression => bounded(first.convert, expression))
    const references = expressions.some(expression => /\\(?:eq)?ref\s*\{/.test(expression.source))
    let output = initial
    if (references) {
      characters = key.length
      const second = converter(numbering, true)
      second.input.parseOptions.tags.allLabels = { ...first.input.parseOptions.tags.allLabels }
      output = expressions.map((expression, index) => {
        const result = bounded(second.convert, expression)
        return /<merror\b/.test(initial[index]) ? initial[index] : result
      })
    }
    const size = key.length + output.reduce((total, value) => total + value.length, 0)
    if (size > MAX_CACHE_CHARACTERS) throw new Error('公式渲染结果超过 2 MB，保留源码，请拆分文档。')
    cacheResult(key, { output, size })
    return output
  } catch (failure) {
    const error = failure instanceof Error ? failure : new Error('公式渲染失败，保留源码。')
    cacheResult(key, { error, size: key.length + error.message.length })
    throw error
  }
}

// Native MathML avoids remote font downloads and works offline in Chromium.
export function renderMathML(source: string, display: boolean): string {
  return renderMathSequence([{ source, display, line: 1 }], false)[0]
}
