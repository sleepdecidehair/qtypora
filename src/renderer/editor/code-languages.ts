import { languages } from '@codemirror/language-data'
import type { LanguageDescription } from '@codemirror/language'

export interface CodeLanguageOption {
  name: string
  value: string
  aliases: readonly string[]
}

const compatibilityAliases: Record<string, readonly string[]> = {
  C: ['clike', 'csrc'],
  'C++': ['cc', 'c++src'],
  JavaScript: ['text/javascript'],
  TypeScript: ['text/typescript'],
  JSX: ['react'],
  HTML: ['htmlmixed', 'html4', 'html5'],
  Markdown: ['md', 'mkd', 'gfm', 'github flavored markdown'],
  Python: ['py'],
  Go: ['golang', 'go-lang'],
  Jinja: ['jinja2', 'django'],
  'Common Lisp': ['commonlisp'],
  'MariaDB SQL': ['mariadb'],
  'MS SQL': ['mssql'],
  PHP: ['php+html'],
  'Objective-C': ['obj-c', 'objectivec'],
  Octave: ['matlab'],
  PGP: ['pgp-keys'],
  R: ['rlang', 'r-lang'],
  Shell: ['terminal'],
  DTD: ['xml-dtd'],
  'TiddlyWiki': ['wiki'],
  'Tiki wiki': ['tiki', 'tikiwiki', 'tiki-wiki'],
  'VB.NET': ['vb', 'basic', 'visualbasic', 'visual basic'],
  Vue: ['vue.js', 'vue-template'],
  'Web IDL': ['web-idl'],
}

const descriptions = new Map<string, LanguageDescription>()
export const codeLanguageOptions: readonly CodeLanguageOption[] = languages.map(language => {
  const value = compatibilityAliases[language.name]?.[0] && /\s/.test(language.name)
    ? compatibilityAliases[language.name][0] : language.name.toLowerCase().replace(/\s+/g, '-')
  const aliases = [...new Set([value, language.name.toLowerCase(), ...language.alias, ...(compatibilityAliases[language.name] || [])])]
  for (const alias of aliases) descriptions.set(alias, language)
  return { name: language.name, value, aliases }
}).sort((first, second) => first.name.localeCompare(second.name, 'en', { sensitivity: 'base' }))

export function codeLanguageForInfo(info: string): LanguageDescription | null {
  return descriptions.get(info.trim().toLowerCase()) || null
}

export function codeLanguageSuggestions(query: string): readonly CodeLanguageOption[] {
  const prefix = query.trim().toLowerCase()
  return codeLanguageOptions.filter(option => option.aliases.some(alias => alias.startsWith(prefix)))
}

export function codeLanguageInputValue(input: string): string {
  const value = input.trim().replace(/[`\r\n]/g, '')
  if (!/\s/.test(value)) return value
  const language = codeLanguageForInfo(value)
  return language ? codeLanguageOptions.find(option => option.name === language.name)!.value : value
}
