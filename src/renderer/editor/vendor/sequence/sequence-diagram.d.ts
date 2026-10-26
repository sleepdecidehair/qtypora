interface SequenceDiagramInstance {
  clean(): void
  actors: unknown[]
  signals: unknown[]
  drawSVG(container: HTMLElement, options: { theme: 'simple'; 'font-size'?: number; 'font-family'?: string }): void
}
declare const SequenceDiagram: { parse(source: string): SequenceDiagramInstance }
export default SequenceDiagram
