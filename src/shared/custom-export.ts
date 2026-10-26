export interface CustomExportPreset {
  name: string
  extension: string
  executable: string
  args: string[]
  input: 'markdown' | 'html'
  template: string
}

export function normalizeCustomExport(input: unknown): CustomExportPreset[] {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 10) throw new Error('最多保存 10 个自定义导出配置。')
  const names = new Set<string>()
  return input.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('自定义导出配置无效。')
    const value = raw as Record<string, unknown>
    const text = (key: string, max: number) => {
      const candidate = value[key]
      if (typeof candidate !== 'string' || candidate.length > max || /[\x00-\x1f\x7f]/.test(candidate)) throw new Error('自定义导出文本无效。')
      return candidate
    }
    const name = text('name', 80).trim()
    if (!name || names.has(name)) throw new Error('自定义导出名称不能为空或重复。')
    names.add(name)
    const extension = text('extension', 16)
    if (!/^[a-z0-9]{1,16}$/.test(extension)) throw new Error('导出扩展名只能包含小写字母与数字。')
    const executable = text('executable', 4096)
    const template = text('template', 4096)
    const absolute = (path: string) => /^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path)
    if (!absolute(executable) || (template && !absolute(template))) throw new Error('导出程序和模板需要绝对路径。')
    if (value.input !== 'markdown' && value.input !== 'html') throw new Error('导出输入格式无效。')
    if (!Array.isArray(value.args) || value.args.length > 40 || value.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\x00-\x1f\x7f]/.test(arg))) throw new Error('导出参数无效。')
    const args = value.args as string[]
    if (!args.some(arg => arg.includes('{input}')) || !args.some(arg => arg.includes('{output}'))) throw new Error('导出参数必须包含 {input} 和 {output}。')
    if (args.some(arg => arg.includes('{template}')) && !template) throw new Error('请填写模板路径或删除 {template} 参数。')
    return { name, extension, executable, template, input: value.input, args: [...args] }
  })
}
