/** Preserve cell boundaries when inserting text containing newlines or pipes. */
export function escapeTableCellInput(content: string): string {
  return content.replace(/\r?\n/g, '<br>').replace(/(\\*)\|/g, (match: string, slashes: string) => slashes.length % 2 ? match : `${slashes}\\|`)
}
