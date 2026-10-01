import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PREFERENCES, type DesktopApi, type Preferences } from '../../shared/contracts'

export function usePreferences(api: DesktopApi, reportError: (message: string) => void) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const preferencesRef = useRef<Preferences>(DEFAULT_PREFERENCES)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasPendingChanges = useRef(false)
  const inFlight = useRef<Promise<void>>(Promise.resolve())
  const loadPreferences = useCallback((value: Preferences) => {
    const normalized = { ...value, readingMode: false }
    preferencesRef.current = normalized
    setPreferences(normalized)
  }, [])
  const flushPreferences = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!hasPendingChanges.current) { await inFlight.current; return }
    const value = preferencesRef.current
    hasPendingChanges.current = false
    inFlight.current = inFlight.current.then(async () => {
      const result = await api.updatePreferences(value)
      if (!result.ok) reportError(result.error.message)
    }).catch((error: unknown) => reportError(error instanceof Error ? error.message : '偏好保存失败'))
    await inFlight.current
  }, [api, reportError])
  const updatePreferences = useCallback((changes: Partial<Preferences>) => {
    const next = { ...preferencesRef.current, ...changes }
    loadPreferences(next)
    hasPendingChanges.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flushPreferences() }, 180)
  }, [flushPreferences, loadPreferences])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => { media.removeEventListener('change', onChange); if (timer.current) clearTimeout(timer.current) }
  }, [])
  return {
    preferences, preferencesRef, loadPreferences, updatePreferences, flushPreferences,
    theme: preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme,
  }
}
