export interface SpellingResult { word: string; misspelled: boolean; suggestions: string[]; ignored?: boolean }
export interface SpellingFrame { isWordMisspelled(word: string): boolean; getWordSuggestions(word: string): string[] }

export function validSpellingWord(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u.test(value)
}

/** Runs in the isolated preload against Electron's current webFrame. */
export function readSpelling(frame: SpellingFrame, input: unknown, ignored = false): SpellingResult {
  if (!validSpellingWord(input)) throw new Error('请选择不超过 128 个字符的单词。')
  const misspelled = frame.isWordMisspelled(input)
  const suggestions = misspelled && !ignored ? [...new Set(frame.getWordSuggestions(input))].filter(value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value)).slice(0, 5) : []
  return { word: input, misspelled, suggestions, ...(ignored ? { ignored: true } : {}) }
}

/** One instance per isolated preload. It never reads or changes the system dictionary. */
export class SessionSpelling {
  private readonly ignored = new Map<string, string>()

  private key(input: unknown): string {
    if (!validSpellingWord(input)) throw new Error('请选择不超过 128 个字符的单词。')
    return input.normalize('NFC').toLowerCase()
  }

  read(frame: SpellingFrame, input: unknown): SpellingResult {
    return readSpelling(frame, input, this.ignored.has(this.key(input)))
  }

  ignore(input: unknown): string[] {
    const key = this.key(input)
    if (!this.ignored.has(key)) {
      if (this.ignored.size >= 500) throw new Error('当前窗口最多忽略 500 个单词，请先移除部分记录。')
      this.ignored.set(key, (input as string).normalize('NFC'))
    }
    return this.list()
  }

  restore(input: unknown): string[] {
    this.ignored.delete(this.key(input))
    return this.list()
  }

  list(): string[] { return [...this.ignored.values()].sort((a, b) => a.localeCompare(b)) }

  clear(): string[] { this.ignored.clear(); return [] }
}
