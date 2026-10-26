import { validateLegacyDiagram, type LegacyDiagramKind } from './legacy-diagram-policy'

export async function drawLegacyDiagram(source: string, kind: LegacyDiagramKind, host: HTMLElement, theme: 'light' | 'dark'): Promise<string> {
  validateLegacyDiagram(source, kind)
  let cleanup: (() => void) | undefined
  try {
    if (kind === 'flow') {
      const { default: flowchart } = await import('flowchart.js')
      const diagram = flowchart.parse(source)
      diagram.drawSVG(host, { 'font-family': 'sans-serif', 'font-size': 16, 'font-color': theme === 'dark' ? '#e5e7eb' : '#262b32', 'line-color': theme === 'dark' ? '#cbd5e1' : '#364152', 'element-color': theme === 'dark' ? '#cbd5e1' : '#364152', fill: theme === 'dark' ? '#202731' : '#ffffff', 'line-width': 2 })
      cleanup = () => diagram.clean()
    } else {
      const { default: sequence } = await import('./vendor/sequence/sequence-diagram.js')
      const diagram = sequence.parse(source)
      if (diagram.actors.length > 50 || diagram.signals.length > 200) throw new Error('时序图最多包含 50 个参与者和 200 条消息')
      cleanup = () => diagram.clean()
      diagram.drawSVG(host, { theme: 'simple', 'font-size': 16, 'font-family': 'monospace' })
    }
    const svg = host.querySelector('svg')
    if (!svg) throw new Error('图表没有生成 SVG')
    const width = Number(svg.getAttribute('width'))
    const height = Number(svg.getAttribute('height'))
    if (!svg.hasAttribute('viewBox') && width > 0 && height > 0) svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    if (!svg.getAttribute('viewBox')) throw new Error('图表缺少有效尺寸')
    return new XMLSerializer().serializeToString(svg)
  } finally { cleanup?.() }
}
