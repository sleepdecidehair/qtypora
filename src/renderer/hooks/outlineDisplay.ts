import type { OutlineHeading } from './outline'

export interface OutlineRow { heading: OutlineHeading; index: number; hasChildren: boolean; number: string }

export function outlineRows(headings: OutlineHeading[], collapsed: ReadonlySet<number>, filter = ''): OutlineRow[] {
  const needle = filter.trim().toLocaleLowerCase()
  const counters = [0, 0, 0, 0, 0, 0]
  let hiddenBelow: number | null = null
  return headings.flatMap((heading, index) => {
    counters[heading.level - 1]++
    counters.fill(0, heading.level)
    const number = counters.slice(0, heading.level).filter(Boolean).join('.')
    const hasChildren = (headings[index + 1]?.level ?? 0) > heading.level
    if (needle) return heading.text.toLocaleLowerCase().includes(needle) ? [{ heading, index, hasChildren, number }] : []
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
