import type { Preferences } from './contracts'
import { SHORTCUT_DEFINITIONS, type ShortcutCommand } from './shortcuts'
import type { ExportOptions, SavedExportPreset } from './export-options'
import type { CustomExportPreset } from './custom-export'

type NestedPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? NestedPartial<T[K]> : T[K] }
export interface NamedPresetDelta<T> { upsert: T[]; remove: string[] }
export type PreferencesPatch = Omit<NestedPartial<Preferences>, 'shortcuts' | 'export'> & {
  shortcuts?: Partial<Record<ShortcutCommand, string | null>>
  export?: Omit<NestedPartial<ExportOptions>, 'savedPresets' | 'customPresets'> & {
    savedPresets?: SavedExportPreset[] | NamedPresetDelta<SavedExportPreset>
    customPresets?: CustomExportPreset[] | NamedPresetDelta<CustomExportPreset>
  }
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const shortcutCommands = new Set<string>(SHORTCUT_DEFINITIONS.map(item => item.command))
const presetLists = ['savedPresets', 'customPresets'] as const

function presetName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('导出预设变更名称无效。')
  return value.trim()
}

function mergePresets(current: { name: string }[], change: unknown, key: typeof presetLists[number]): unknown[] {
  if (Array.isArray(change)) return change
  if (!record(change) || Object.keys(change).some(field => field !== 'upsert' && field !== 'remove') || !Array.isArray(change.upsert) || !Array.isArray(change.remove)) throw new Error('导出预设变更需包含 upsert 和 remove 数组。')
  const max = key === 'savedPresets' ? 20 : 10
  if (change.upsert.length > max || change.remove.length > max) throw new Error('导出预设变更数量超出范围。')
  const remove = change.remove.map(presetName)
  if (new Set(remove).size !== remove.length) throw new Error('导出预设删除名称重复。')
  const fields = key === 'savedPresets' ? ['name', 'format', 'settings'] : ['name', 'extension', 'executable', 'args', 'input', 'template']
  const upsert = new Map<string, Record<string, unknown>>()
  for (const item of change.upsert) {
    if (!record(item) || Object.keys(item).some(field => !fields.includes(field)) || fields.some(field => !Object.hasOwn(item, field))) throw new Error('导出预设变更字段无效。')
    const name = presetName(item.name)
    if (upsert.has(name) || remove.includes(name)) throw new Error('导出预设变更名称重复或冲突。')
    upsert.set(name, { ...item, name })
  }
  const result: unknown[] = []
  for (const item of current) {
    if (remove.includes(item.name)) continue
    result.push(upsert.get(item.name) ?? item)
    upsert.delete(item.name)
  }
  result.push(...upsert.values())
  if (result.length > max) throw new Error('导出预设数量超出范围。')
  return result
}

/** Arrays are values; nested setting groups merge by field. Unknown keys are rejected. */
export function mergePreferencePatch(base: Preferences, patch: unknown): Preferences {
  const merge = (current: Record<string, unknown>, changes: unknown): Record<string, unknown> => {
    if (!record(changes)) throw new Error('偏好变更必须是对象。')
    const result = { ...current }
    for (const [key, value] of Object.entries(changes)) {
      if (!Object.hasOwn(current, key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('偏好字段无效。')
      result[key] = record(current[key]) && record(value) ? merge(current[key], value) : value
    }
    return result
  }
  // Missing commands retain their value; null restores the default and '' disables it.
  const shortcuts = { ...base.shortcuts }
  if (record(patch) && Object.hasOwn(patch, 'shortcuts')) {
    if (!record(patch.shortcuts)) throw new Error('快捷键变更必须是对象。')
    for (const [command, value] of Object.entries(patch.shortcuts)) {
      if (!shortcutCommands.has(command) || (value !== null && typeof value !== 'string')) throw new Error('快捷键变更无效。')
      if (value === null) delete shortcuts[command as ShortcutCommand]
      else shortcuts[command as ShortcutCommand] = value
    }
  }
  const next = record(patch) ? { ...patch } : patch
  if (record(next)) {
    delete next.shortcuts
    if (record(next.export)) {
      const changes = { ...next.export }
      for (const key of presetLists) if (Object.hasOwn(changes, key)) changes[key] = mergePresets(base.export[key], changes[key], key)
      if (Array.isArray(changes.customPresets) && !Object.hasOwn(changes, 'customPreset') && base.export.customPreset && !changes.customPresets.some(item => record(item) && item.name === base.export.customPreset)) changes.customPreset = ''
      next.export = changes
    }
  }
  return { ...merge(base as unknown as Record<string, unknown>, next), shortcuts } as unknown as Preferences
}

export function preferenceDifference(before: Preferences, after: Preferences): PreferencesPatch {
  const diff = (old: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(old[key]) === JSON.stringify(value)) continue
      if ((key === 'savedPresets' || key === 'customPresets') && Array.isArray(old[key]) && Array.isArray(value)) {
        const previous = new Map((old[key] as { name: string }[]).map(item => [item.name, item]))
        const current = new Map((value as { name: string }[]).map(item => [item.name, item]))
        result[key] = {
          upsert: [...current.values()].filter(item => JSON.stringify(previous.get(item.name)) !== JSON.stringify(item)),
          remove: [...previous.keys()].filter(name => !current.has(name)),
        }
      } else if (key === 'shortcuts' && record(old[key]) && record(value)) {
        const changes: Record<string, unknown> = {}
        for (const command of new Set([...Object.keys(old[key]), ...Object.keys(value)])) {
          if (old[key][command] !== value[command]) changes[command] = Object.hasOwn(value, command) ? value[command] : null
        }
        result[key] = changes
      } else result[key] = record(old[key]) && record(value) ? diff(old[key], value) : value
    }
    return result
  }
  return diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>) as PreferencesPatch
}
