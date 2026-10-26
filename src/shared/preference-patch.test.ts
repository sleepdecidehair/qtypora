import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from './contracts'
import { mergePreferencePatch, preferenceDifference } from './preference-patch'
import { validatePreferences } from '../main/preferences'
import { exportPresetSettings, type SavedExportPreset } from './export-options'
import type { CustomExportPreset } from './custom-export'

const saved = (name: string): SavedExportPreset => ({ name, format: 'pdf', settings: exportPresetSettings(DEFAULT_PREFERENCES.export) })
const custom = (name: string): CustomExportPreset => ({ name, extension: 'txt', executable: '/tmp/converter', args: ['{input}', '{output}'], input: 'markdown', template: '' })

describe('preference field changes', () => {
  it('merges unrelated nested edits from two stale windows', () => {
    const first = preferenceDifference(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES, markdown: { ...DEFAULT_PREFERENCES.markdown, mathNumbering: true } })
    const second = preferenceDifference(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES, markdown: { ...DEFAULT_PREFERENCES.markdown, alerts: false }, fontSize: 22 })
    const result = validatePreferences(mergePreferencePatch(mergePreferencePatch(DEFAULT_PREFERENCES, first), second))
    expect(result.markdown.mathNumbering).toBe(true)
    expect(result.markdown.alerts).toBe(false)
    expect(result.fontSize).toBe(22)
  })
  it('rejects unknown keys and invalid concrete values without weakening validation', () => {
    expect(() => mergePreferencePatch(DEFAULT_PREFERENCES, JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow()
    expect(() => mergePreferencePatch(DEFAULT_PREFERENCES, { export: { bad: 1 } })).toThrow()
    expect(() => validatePreferences(mergePreferencePatch(DEFAULT_PREFERENCES, { export: { imageWidth: 1000.5 } }))).toThrow()
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, theme: ['light'] })).toThrow()
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, export: { pageSize: ['A4'] } })).toThrow()
    expect(() => mergePreferencePatch(DEFAULT_PREFERENCES, { shortcuts: { unknown: 'Alt+N' } })).toThrow()
    expect(() => mergePreferencePatch(DEFAULT_PREFERENCES, { shortcuts: { new: false } })).toThrow()
    expect(() => mergePreferencePatch(DEFAULT_PREFERENCES, { shortcuts: null })).toThrow()
    expect(() => validatePreferences(mergePreferencePatch(DEFAULT_PREFERENCES, { shortcuts: { new: 'CmdOrCtrl+C' } }))).toThrow()
  })
  it('keeps independent shortcut edits from two stale windows', () => {
    const first = preferenceDifference(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES, shortcuts: { new: 'Alt+N' } })
    const second = preferenceDifference(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES, shortcuts: { save: 'Alt+S' } })
    const merged = validatePreferences(mergePreferencePatch(mergePreferencePatch(DEFAULT_PREFERENCES, first), second))
    expect(merged.shortcuts).toEqual({ new: 'Alt+N', save: 'Alt+S' })
  })
  it('restores one default without deleting another window shortcut and preserves explicit disabling', () => {
    const before = { ...DEFAULT_PREFERENCES, shortcuts: { new: 'Alt+N' } }
    const reset = preferenceDifference(before, { ...before, shortcuts: {} })
    expect(reset).toEqual({ shortcuts: { new: null } })
    const otherWindow = mergePreferencePatch(before, { shortcuts: { save: 'Alt+S' } })
    const merged = validatePreferences(mergePreferencePatch(otherWindow, reset))
    expect(merged.shortcuts).toEqual({ save: 'Alt+S' })
    const disabled = validatePreferences(mergePreferencePatch(merged, { shortcuts: { new: '' } }))
    expect(disabled.shortcuts).toEqual({ new: '', save: 'Alt+S' })
  })
  for (const [key, create] of [['savedPresets', saved], ['customPresets', custom]] as const) {
    it(`merges independent ${key} additions from stale windows and a stale deletion preserves new entries`, () => {
      const base = { ...DEFAULT_PREFERENCES, export: { ...DEFAULT_PREFERENCES.export, [key]: [create('Original')] } }
      const first = preferenceDifference(base, { ...base, export: { ...base.export, [key]: [...base.export[key], create('First')] } })
      const second = preferenceDifference(base, { ...base, export: { ...base.export, [key]: [...base.export[key], create('Second')] } })
      const merged = validatePreferences(mergePreferencePatch(mergePreferencePatch(base, first), second))
      expect(merged.export[key].map(item => item.name)).toEqual(['Original', 'First', 'Second'])
      const remove = preferenceDifference(base, { ...base, export: { ...base.export, [key]: [] } })
      expect(remove).toEqual({ export: { [key]: { upsert: [], remove: ['Original'] } } })
      const remaining = validatePreferences(mergePreferencePatch(merged, remove))
      expect(remaining.export[key].map(item => item.name)).toEqual(['First', 'Second'])
      const replaced = validatePreferences(mergePreferencePatch(remaining, { export: { [key]: [create('Replacement')] } }))
      expect(replaced.export[key].map(item => item.name)).toEqual(['Replacement'])
    })
  }
  it('clears a deleted active custom preset but rejects an explicitly selected missing preset', () => {
    const base = { ...DEFAULT_PREFERENCES, export: { ...DEFAULT_PREFERENCES.export, customPresets: [custom('First'), custom('Second')], customPreset: 'First' } }
    const merged = validatePreferences(mergePreferencePatch(base, { export: { customPresets: { upsert: [], remove: ['First'] } } }))
    expect(merged.export.customPreset).toBe('')
    expect(merged.export.customPresets.map(item => item.name)).toEqual(['Second'])
    expect(() => validatePreferences(mergePreferencePatch(base, { export: { customPresets: { upsert: [], remove: ['First'] }, customPreset: 'First' } }))).toThrow('有效')
  })
  it('rejects malformed preset deltas, unknown fields, conflicting names and invalid settings', () => {
    for (const change of [{ upsert: [] }, { upsert: [], remove: [], unknown: true }, { upsert: [saved('A')], remove: ['A'] }, { upsert: [saved('A'), saved('A')], remove: [] }, { upsert: [], remove: ['A', 'A'] }, { upsert: [{ ...saved('A'), executable: '/tmp/not-allowed' }], remove: [] }]) {
      expect(() => mergePreferencePatch(DEFAULT_PREFERENCES, { export: { savedPresets: change } })).toThrow()
    }
    expect(() => validatePreferences(mergePreferencePatch(DEFAULT_PREFERENCES, { export: { savedPresets: { upsert: [{ ...saved('A'), settings: { ...saved('A').settings, pageSize: 'bad' } }], remove: [] } } }))).toThrow('纸张')
  })
})
