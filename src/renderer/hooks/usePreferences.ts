import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PREFERENCES, type DesktopApi, type Preferences } from '../../shared/contracts'
import { mergePreferencePatch, preferenceDifference, type PreferencesPatch } from '../../shared/preference-patch'

export function usePreferences(api: DesktopApi, reportError: (message: string) => void) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const preferencesRef = useRef<Preferences>(DEFAULT_PREFERENCES)
  const confirmedVersion = useRef(-1)
  const confirmed = useRef<Preferences>(DEFAULT_PREFERENCES)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<PreferencesPatch[]>([])
  const queued = useRef<PreferencesPatch[][]>([])
  const inFlight = useRef<Promise<boolean>>(Promise.resolve(true))
  const runningBatches = useRef(0)
  const publish = useCallback(() => {
    let value = confirmed.current
    for (const patch of [...queued.current.flat(), ...pending.current]) value = mergePreferencePatch(value, patch)
    preferencesRef.current = { ...value, readingMode: false }
    setPreferences(preferencesRef.current)
  }, [])
  const loadPreferences = useCallback((value: Preferences, version = 0) => { if (version < confirmedVersion.current) return; confirmedVersion.current = version; confirmed.current = value; publish() }, [publish])
  const flushPreferences = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!pending.current.length) return runningBatches.current ? await inFlight.current : true
    const batch = pending.current
    pending.current = []
    queued.current.push(batch)
    const preceding = runningBatches.current ? inFlight.current : Promise.resolve(true)
    runningBatches.current++
    inFlight.current = preceding.then(async previousSucceeded => {
      let succeeded = false
      try {
        const before = confirmed.current
        const after = batch.reduce<Preferences>((value, patch) => mergePreferencePatch(value, patch), before)
        const result = await api.patchPreferences(preferenceDifference(before, after))
        if (!result.ok) reportError(result.error.message)
        else { loadPreferences(result.data.preferences, result.data.version); succeeded = true }
      } catch (error) { reportError(error instanceof Error ? error.message : '偏好保存失败') }
      finally { queued.current = queued.current.filter(item => item !== batch); runningBatches.current--; publish() }
      return previousSucceeded && succeeded
    })
    return await inFlight.current
  }, [api, reportError, publish, loadPreferences])
  const updatePreferences = useCallback((changes: Partial<Preferences>) => {
    const before = preferencesRef.current
    const patch = preferenceDifference(before, { ...before, ...changes })
    if (!Object.keys(patch).length) return
    pending.current.push(patch)
    publish()
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flushPreferences() }, 180)
  }, [flushPreferences, publish])
  useEffect(() => api.onEvent(event => { if (event.type === 'preferences-changed') loadPreferences(event.preferences, event.version) }), [api, loadPreferences])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => { media.removeEventListener('change', onChange); if (timer.current) clearTimeout(timer.current) }
  }, [])
  return { preferences, preferencesRef, loadPreferences, updatePreferences, flushPreferences,
    theme: preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme }
}
