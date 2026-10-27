import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { translate, type AppLocale } from '../../shared/i18n'

const LocaleContext = createContext<AppLocale>('zh-CN')
export function LocaleProvider({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}
export function useLocale(): AppLocale { return useContext(LocaleContext) }
export function useTranslation(): (source: string) => string {
  const locale = useLocale()
  return useCallback((source: string) => translate(locale, source), [locale])
}
