import type { Session } from 'electron'
import { DesktopError, invalid } from './errors'
import { validSpellingWord } from '../shared/spelling'

type SpellingDictionary = Pick<Session, 'addWordToSpellCheckerDictionary' | 'removeWordFromSpellCheckerDictionary' | 'listWordsInSpellCheckerDictionary'>

export function spellingWord(value: unknown): string {
  if (!validSpellingWord(value)) invalid('请选择不超过 128 个字符的单词。')
  return value
}

export function learnSpelling(session: SpellingDictionary, input: unknown): void {
  if (!session.addWordToSpellCheckerDictionary(spellingWord(input))) throw new DesktopError('IO_ERROR', '无法将单词保存到自定义词典。')
}

export function forgetSpelling(session: SpellingDictionary, input: unknown): void {
  if (!session.removeWordFromSpellCheckerDictionary(spellingWord(input))) throw new DesktopError('IO_ERROR', '无法从自定义词典移除单词。')
}

export async function listSpellingWords(session: SpellingDictionary): Promise<string[]> {
  return [...new Set(await session.listWordsInSpellCheckerDictionary())].sort((first, second) => first.localeCompare(second))
}
