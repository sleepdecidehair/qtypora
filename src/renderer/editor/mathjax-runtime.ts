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

RegisterHTMLHandler(liteAdaptor())
const input = new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined'], maxBuffer: 8192, maxMacros: 1000 })
const mathDocument = mathjax.document('', { InputJax: input })
const visitor = new SerializedMmlVisitor()

// Native MathML avoids MathJax 4's font-range downloads and works offline in Chromium.
export function renderMathML(source: string, display: boolean): string {
  if (source.length > 8192) throw new Error('公式超过 8192 字符，保留源码')
  input.reset()
  const node = mathDocument.convert(source, { display, end: STATE.CONVERT })
  return visitor.visitTree(node)
}
