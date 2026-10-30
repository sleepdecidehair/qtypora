import type { OutlineHeading } from './outline'

export interface OutlineRow { heading: OutlineHeading; index: number; hasChildren: boolean; number: string }

/** Map case-folded search offsets back to whole source code points. */
export function outlineMatchRange(text: string, filter: string): { from: number; to: number } | null {
  const needle = filter.trim().toLocaleLowerCase()
  if (!needle) return null
  const lower = text.toLocaleLowerCase()
  let offset = 0
  const starts: number[] = [], ends: number[] = []
  for (const character of text) {
    const folded = character.toLocaleLowerCase()
    for (let i = 0; i < folded.length; i++) { starts.push(offset); ends.push(offset + character.length) }
    offset += character.length
  }
  if (starts.length !== lower.length) return null
  const index = lower.indexOf(needle)
  return index < 0 ? null : { from: starts[index], to: ends[index + needle.length - 1] }
}

export function outlineRows(headings: OutlineHeading[], collapsed: ReadonlySet<number>, filter = '', flat = false): OutlineRow[] {
  const needle = filter.trim().toLocaleLowerCase()
  const counters = [0, 0, 0, 0, 0, 0]
  let hiddenBelow: number | null = null
  return headings.flatMap((heading, index) => {
    counters[heading.level - 1]++
    counters.fill(0, heading.level)
    const number = counters.slice(0, heading.level).filter(Boolean).join('.')
    const hasChildren = (headings[index + 1]?.level ?? 0) > heading.level
    if (needle) return heading.text.toLocaleLowerCase().includes(needle) ? [{ heading, index, hasChildren, number }] : []
    if (flat) return [{ heading, index, hasChildren, number }]
    if (hiddenBelow !== null && heading.level > hiddenBelow) return []
    hiddenBelow = collapsed.has(heading.line) ? heading.level : null
    return [{ heading, index, hasChildren, number }]
  })
}

export function currentOutlineLine(headings: OutlineHeading[], line: number): number | null {
  let active: number | null = null
  for (const heading of headings) {
    if (heading.line > line) break
    active = heading.line
  }
  return active
}

/** Ancestors needed to reveal a heading, ordered from nearest to farthest. */
export function outlineAncestors(headings: OutlineHeading[], line: number | null): number[] {
  const index = headings.findIndex(heading => heading.line === line)
  if (index < 0) return []
  const ancestors: number[] = []
  let level = headings[index].level
  for (let i = index - 1; i >= 0 && level > 1; i--) {
    if (headings[i].level < level) { ancestors.push(headings[i].line); level = headings[i].level }
  }
  return ancestors
}
