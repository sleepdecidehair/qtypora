export const MAX_EXPORT_HTML_CHARACTERS = 24 * 1024 * 1024

/** Match the IPC string limit before allocating repeated base64 or replacing HTML. */
export class ExportBudget {
  private characters: number
  constructor(initial = 0, readonly limit = MAX_EXPORT_HTML_CHARACTERS) {
    this.characters = initial
    this.replace(0, 0)
  }
  replace(previous: number, next: number, references = 1): void {
    const total = this.characters + (next - previous) * references
    if (!Number.isSafeInteger(total) || total < 0 || total > this.limit) throw new Error('导出 HTML 超过 24 MB，请缩小图片或拆分文档后重试。')
    this.characters = total
  }
}

export function base64DataUrlLength(bytes: number, mime: string): number {
  return Math.ceil(bytes / 3) * 4 + `data:${mime};base64,`.length
}

/** Resolve each resource once, but charge every final occurrence before expanding HTML. */
export async function inlineResourceImages(html: string, load: (source: string) => Promise<string>, limit = MAX_EXPORT_HTML_CHARACTERS): Promise<string> {
  const counts = new Map<string, number>()
  const pattern = /qtypora-media:\/\/resource\/[a-f0-9-]+/gi
  for (const match of html.matchAll(pattern)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1)
  const budget = new ExportBudget(html.length, limit)
  const replacements = new Map<string, string>()
  for (const [source, count] of counts) {
    const data = await load(source)
    budget.replace(source.length, data.length, count)
    replacements.set(source, data)
  }
  return html.replace(pattern, source => replacements.get(source)!)
}

/** A loader reserves its encoded size before FileReader allocates the base64 string. */
export async function prepareExportImages(sources: string[], resolve: (source: string) => Promise<string>, load: (resolved: string, reserve: (length: number) => void) => Promise<string>, budget: ExportBudget): Promise<Map<string, string>> {
  const resolvedSources = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const source of sources) {
    let resolved = resolvedSources.get(source)
    if (resolved === undefined) { resolved = await resolve(source); resolvedSources.set(source, resolved) }
    counts.set(resolved, (counts.get(resolved) ?? 0) + 1)
  }
  const embedded = new Map<string, string>()
  for (const [resolved, count] of counts) {
    let reserved = 0
    const reserve = (length: number): void => { budget.replace(reserved, length, count); reserved = length }
    const data = await load(resolved, reserve)
    reserve(data.length)
    embedded.set(resolved, data)
  }
  return new Map([...resolvedSources].map(([source, resolved]) => [source, embedded.get(resolved)!]))
}
