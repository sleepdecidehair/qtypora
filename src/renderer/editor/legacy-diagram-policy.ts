export type LegacyDiagramKind = 'flow' | 'sequence'

export function validateLegacyDiagram(source: string, kind: LegacyDiagramKind): void {
  if (source.length > 20000 || source.split('\n').length > 300) throw new Error('图表过大，请限制在 300 行和 2 万字符以内')
  if (kind === 'flow') {
    if (/:>|:\$|@>/.test(source)) throw new Error('流程图不支持链接、事件回调或自定义线条配置')
    if (/(?:^|[^\w])(?:__proto__|prototype|constructor)(?:$|[^\w])/i.test(source)) throw new Error('流程图节点名称无效')
    if ((source.match(/=>/g)?.length ?? 0) > 100 || (source.match(/->/g)?.length ?? 0) > 200) throw new Error('流程图最多包含 100 个节点和 200 条连线')
  }
}
