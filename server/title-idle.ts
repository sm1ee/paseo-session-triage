import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { triagePreferences } from "../shared/triage";

export function idleTitleCandidate(agent: PaseoAgent): boolean {
  return !!agent.workspaceId && !agent.archivedAt && !agent.activeTurn &&
    !["initializing", "error"].includes(agent.status) && !agent.pendingPermissions.length &&
    !agent.internal && !agent.labels["paseo.parent-agent-id"] && agent.labels["session-triage.title-helper"] !== "1";
}

// One metadata page per 15 minutes, with a cursor for older sessions. No history
// reads here; the shared generator queue handles quotas and deduplication.
export class IdleTitleScanner {
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private cursor?: string;
  private generation = 0;
  private pending: Promise<void> = Promise.resolve();
  private running = false;
  private controller?: AbortController;
  constructor(private readonly settings: PluginSettings<typeof triagePreferences.schema>,
    private readonly api: () => Promise<PaseoApi>,
    private readonly enqueue: (api: PaseoApi, agent: PaseoAgent) => Promise<void>) {}
  wake(): void {
    this.generation++; this.cursor = undefined; this.controller?.abort(); clearTimeout(this.timer);
    if (!this.stopped) this.timer = setTimeout(() => { this.timer = undefined; this.pending = this.pending.then(() => this.scan()); }, 10_000);
  }
  async stop(): Promise<void> { this.stopped = true; this.generation++; clearTimeout(this.timer); this.controller?.abort(); await this.pending; }
  private async scan(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    const generation = this.generation;
    let enabled = false;
    const abort = new AbortController(); this.controller = abort;
    const timeout = setTimeout(() => abort.abort(), 10_000);
    try {
      const state = await this.settings.read();
      if (state.status !== "ready" || !state.values.shortenTitles || !state.values.titleIncludeIdle ||
          !state.values.titleProvider || !state.values.titleModel) return;
      enabled = true;
      const api = await this.api();
      if (this.stopped || generation !== this.generation || abort.signal.aborted) return;
      const result = await api.agents.list({ scope: "active", filter: { includeArchived: false },
        sort: [{ key: "created_at", direction: "asc" }], page: { limit: 50, ...(this.cursor ? { cursor: this.cursor } : {}) }, signal: abort.signal });
      if (this.stopped || generation !== this.generation || abort.signal.aborted) return;
      this.cursor = result.pageInfo.hasMore ? result.pageInfo.nextCursor ?? undefined : undefined;
      for (const { agent } of result.entries) {
        if (this.stopped || generation !== this.generation || abort.signal.aborted) return;
        if (idleTitleCandidate(agent)) await this.enqueue(api, agent);
      }
    } catch { this.cursor = undefined; } // Metadata failures wait for the next scan.
    finally {
      clearTimeout(timeout); this.running = false;
      if (enabled && !this.stopped && generation === this.generation)
        this.timer = setTimeout(() => { this.timer = undefined; this.pending = this.pending.then(() => this.scan()); }, 15 * 60_000);
    }
  }
}
