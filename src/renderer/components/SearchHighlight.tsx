import { Fragment } from 'react'
import { findTextMatches } from '../editor/reading-search'

interface SearchHighlightProps {
  text: string
  query: string
  caseSensitive: boolean
  excerpt?: boolean
}

export function SearchHighlight({ text, query, caseSensitive, excerpt = false }: SearchHighlightProps): React.JSX.Element {
  const matches = findTextMatches(text, query, caseSensitive)
  // Keep a late match in view when the sidebar truncates a long result line.
  let start = excerpt && matches.length ? Math.max(0, matches[0].from - 12) : 0
  if (start && (text.codePointAt(start - 1) ?? 0) > 0xffff) start--
  let cursor = start
  const pieces: React.ReactNode[] = start ? ['…'] : []
  for (const match of matches) {
    pieces.push(<Fragment key={match.from}>{text.slice(cursor, match.from)}<mark className="search-result-match">{text.slice(match.from, match.to)}</mark></Fragment>)
    cursor = match.to
  }
  pieces.push(text.slice(cursor))
  return <>{pieces}</>
}
