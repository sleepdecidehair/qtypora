/** A successful explicit directory listing invalidates other windows' theme snapshots. */
export class ThemeRefresh {
  private revision = 0

  constructor(private readonly broadcast: (revision: number) => void) {}

  async list<T>(operation: () => Promise<T>): Promise<T> {
    const result = await operation()
    this.broadcast(++this.revision)
    return result
  }
}
