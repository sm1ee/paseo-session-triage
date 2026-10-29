// Counts only observed successful turns. Reloads or settings changes restart
// the interval; no session-history scan or per-turn disk write is needed.
export class TitleCadence {
  private sessions = new Map<string, { count: number; seen: string[] }>();
  complete(id: string, turnId?: string | null): boolean {
    let entry = this.sessions.get(id);
    if (entry && turnId && entry.seen.includes(turnId)) return false;
    if (!entry) {
      if (this.sessions.size >= 1000) this.sessions.delete(this.sessions.keys().next().value!);
      entry = { count: 0, seen: [] }; this.sessions.set(id, entry);
    }
    entry.count = Math.min(100, entry.count + 1);
    if (turnId) { entry.seen.push(turnId); if (entry.seen.length > 16) entry.seen.shift(); }
    return true;
  }
  count(id: string): number { return this.sessions.get(id)?.count ?? 0; }
  reset(id: string): void { const entry = this.sessions.get(id); if (entry) entry.count = 0; }
  forget(id: string): void { this.sessions.delete(id); }
  clear(): void { this.sessions.clear(); }
}
