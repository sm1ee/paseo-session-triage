import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { TRIAGE_ORDER, triagePreferences, type TriageRow } from "../shared/triage";
import { classifyAgent } from "./classifier";
import { TitleSync } from "./title-sync";
import { restoreEvidence, triageRevision, type TriageEvidenceStore } from "./triage-evidence";
export { desiredTitle, desiredWorkspaceTitle } from "./titles";

const SCAN_INTERVAL_MS = 15 * 60_000;
type Preferences = ReturnType<typeof triagePreferences.schema.parse>;
type SettingsHandle = PluginSettings<typeof triagePreferences.schema>;

interface Snapshot {
  rows: TriageRow[];
  checkedAt: string | null;
  truncated: boolean;
  error: string | null;
  renameErrors: string[];
}

export class TriageService {
  private snapshotValue: Snapshot = { rows: [], checkedAt: null, truncated: false, error: null, renameErrors: [] };
  private agents = new Map<string, PaseoAgent>();
  private generation = 0;
  private pending: Promise<void> | null = null;
  private inspections = new Map<string, Promise<Snapshot>>();
  private inspected = new Map<string, { revision: string; row: TriageRow }>();
  private epochs = new Map<string, number>();
  private invalidated = new Set<string>();
  private loaded = new Set<string>();
  private replyQueue = new Map<string, { api: PaseoApi; timeline?: readonly AgentTimelineItem[] }>();
  private replyTimer?: ReturnType<typeof setTimeout>;
  private autoBusy = false;
  private configuration = 0;
  private stopped = false;
  private dirty = true;
  private lastAttempt = 0;
  private retryAt = 0;
  private titles?: TitleSync;
  constructor(private readonly settings: SettingsHandle, private readonly now = Date.now, rename?: (id: string, title: string) => Promise<void>,
    private readonly evidence?: TriageEvidenceStore) {
    if (rename) this.titles = new TitleSync(settings, rename, (agent, row) => {
      this.snapshotValue = { ...this.snapshotValue, rows: this.snapshotValue.rows.map(old => old.id === agent.id ? row : old) };
      this.sort(this.snapshotValue.rows);
    }, () => { this.snapshotValue = { ...this.snapshotValue, renameErrors: ["Title update unavailable. Retrying in one minute."] }; }, now,
    (agent, timeline) => this.classify(agent, timeline));
  }
  invalidate(agentId?: string, reuseEvidence = false): void {
    this.generation++; this.dirty = true;
    if (agentId) {
      this.epochs.set(agentId, (this.epochs.get(agentId) ?? 0) + 1);
      if (!reuseEvidence) { this.invalidated.add(agentId); this.inspected.delete(agentId); }
      if (this.epochs.size > 200) { const oldest = this.epochs.keys().next().value!; this.epochs.delete(oldest); this.invalidated.delete(oldest); }
    }
  }
  activity(api: PaseoApi, id: string, timeline?: readonly AgentTimelineItem[], parentId?: string | null, reuseEvidence = false): void {
    this.invalidate(id, reuseEvidence); this.titles?.request(api, id, timeline, undefined, !!parentId);
    if (!parentId) this.queueReply(api, id, timeline);
  }
  archived(id: string): void {
    this.invalidate(id); this.agents.delete(id); this.inspected.delete(id); this.titles?.forget(id);
    this.replyQueue.delete(id);
    this.snapshotValue = { ...this.snapshotValue, rows: this.snapshotValue.rows.filter(row => row.id !== id) };
  }
  settingsChanged(): void { this.configuration++; this.invalidate(); this.titles?.settingsChanged(); this.replyQueue.clear(); clearTimeout(this.replyTimer); this.replyTimer = undefined; }
  stop(): void { this.stopped = true; this.titles?.stop(); clearTimeout(this.replyTimer); this.replyQueue.clear(); }
  checkingReplies(): boolean { return this.autoBusy || this.replyQueue.size > 0; }
  async shortenTitle(api: PaseoApi, id: string, expected: string, title: string, valid: () => boolean): Promise<boolean> {
    const changed = await this.titles?.shorten(api, id, expected, title, valid) ?? false;
    if (changed) { this.generation++; this.dirty = true; }
    return changed;
  }
  async snapshot(api: PaseoApi, refresh: boolean): Promise<Snapshot> {
    if (this.stopped) return this.snapshotValue;
    const previous = this.snapshotValue.checkedAt ? Date.parse(this.snapshotValue.checkedAt) : 0;
    if (!this.pending && (refresh || this.now() >= this.retryAt &&
        (!previous || this.now() - previous >= SCAN_INTERVAL_MS || this.dirty && this.now() - this.lastAttempt >= 10_000))) {
      const task = this.performScan(api); this.pending = task;
      try { await task; } finally { if (this.pending === task) this.pending = null; }
    } else if (this.pending && !this.snapshotValue.checkedAt) await this.pending;
    return this.snapshotValue;
  }
  private async preferences(): Promise<Preferences> {
    const state = await this.settings.read();
    return state.status === "ready" ? state.values : triagePreferences.schema.parse({});
  }
  private async performScan(api: PaseoApi): Promise<void> {
    const generation = this.generation; this.lastAttempt = this.now();
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 6000);
    try {
      const settings = await this.preferences(), agents: PaseoAgent[] = [];
      let cursor: string | undefined, hasMore = false, pages = 0;
      do {
        if (this.stopped || abort.signal.aborted) throw new Error("scan_stopped");
        const result = await api.agents.list({ scope: "active", filter: { includeArchived: false },
          sort: [{ key: "updated_at", direction: "desc" }],
          page: { limit: Math.min(100, settings.maxSessions * 2), ...(cursor ? { cursor } : {}) }, signal: abort.signal });
        for (const { agent } of result.entries) {
          if ("internal" in agent && agent.internal) continue;
          if (agent.labels["session-triage.title-helper"] === "1") continue;
          if (!settings.includeSubagents && agent.labels["paseo.parent-agent-id"]) continue;
          agents.push(agent); if (agents.length >= settings.maxSessions) break;
        }
        cursor = result.pageInfo.nextCursor ?? undefined; hasMore = result.pageInfo.hasMore; pages++;
      } while (agents.length < settings.maxSessions && hasMore && cursor && pages < 3);
      if (this.stopped) return;
      // 목록은 메타데이터만 읽고 제목 쓰기는 별도의 제한된 큐로 보낸다.
      this.agents = new Map(agents.map(agent => [agent.id, agent]));
      for (const id of this.inspected.keys()) if (!this.agents.has(id)) this.inspected.delete(id);
      for (const id of this.loaded) if (!this.agents.has(id)) this.loaded.delete(id);
      for (const agent of agents) await this.loadEvidence(agent);
      if (this.stopped) return;
      const rows = agents.map(agent => this.classify(agent)); this.sort(rows);
      this.snapshotValue = { rows, checkedAt: new Date(this.now()).toISOString(),
        truncated: hasMore || agents.length >= settings.maxSessions, error: null, renameErrors: [] };
      for (const agent of agents) { this.titles?.request(api, agent.id, undefined, agent); if (this.classify(agent).state === "idle") this.queueReply(api, agent.id); }
      this.dirty = generation !== this.generation; this.retryAt = 0;
    } catch {
      this.retryAt = this.now() + 60_000;
      this.snapshotValue = { ...this.snapshotValue, error: "Status unavailable. Showing the last check." };
    } finally { clearTimeout(timer); }
  }
  private sort(rows: TriageRow[]): void {
    rows.sort((a, b) => TRIAGE_ORDER.indexOf(a.state) - TRIAGE_ORDER.indexOf(b.state) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  private classify(agent: PaseoAgent, timeline?: readonly AgentTimelineItem[]): TriageRow {
    const metadata = classifyAgent(agent);
    if (metadata.state !== "idle") return metadata;
    if (timeline?.length) return classifyAgent(agent, timeline);
    const cached = this.inspected.get(agent.id);
    return cached?.revision === triageRevision(agent) ? { ...cached.row, title: metadata.title, updatedAt: agent.updatedAt } : metadata;
  }
  private async loadEvidence(agent: PaseoAgent): Promise<void> {
    if (!this.evidence || this.loaded.has(agent.id) || this.invalidated.has(agent.id)) return;
    this.loaded.add(agent.id);
    const epoch = this.epochs.get(agent.id);
    try {
      const saved = await this.evidence.read(agent.id);
      if (!this.stopped && epoch === this.epochs.get(agent.id) && saved?.revision === triageRevision(agent))
        this.inspected.set(agent.id, { revision: saved.revision, row: restoreEvidence(agent, saved) });
    } catch { /* A missing cache never blocks metadata or live classification. */ }
  }
  private queueReply(api: PaseoApi, id: string, timeline?: readonly AgentTimelineItem[]): void {
    if (this.stopped || this.replyQueue.size >= 100 && !this.replyQueue.has(id)) return;
    this.replyQueue.set(id, { api, timeline: timeline?.length ? timeline.slice(-20) : undefined }); this.scheduleReply();
  }
  private scheduleReply(): void {
    if (this.stopped || this.autoBusy || this.replyTimer || !this.replyQueue.size) return;
    this.replyTimer = setTimeout(() => { this.replyTimer = undefined; void this.nextReply(); }, 3000);
  }
  private async nextReply(): Promise<void> {
    if (this.stopped) return;
    const first = this.replyQueue.entries().next().value; if (!first) return;
    if (this.inspections.size) { this.scheduleReply(); return; }
    const [id, work] = first; this.replyQueue.delete(id); this.autoBusy = true;
    try { await this.inspect(work.api, id, true, work.timeline); } catch { /* Changed/busy sessions await a new event or scan. */ }
    finally { this.autoBusy = false; this.scheduleReply(); }
  }
  inspect(api: PaseoApi, id: string, automatic = false, eventTimeline?: readonly AgentTimelineItem[]): Promise<Snapshot> {
    const pending = this.inspections.get(id); if (pending) return pending;
    if (this.inspections.size >= 1) return Promise.reject(new Error("Another session is being checked."));
    const task = this.inspectOne(api, id, automatic, eventTimeline); this.inspections.set(id, task);
    const clear = () => { if (this.inspections.get(id) === task) this.inspections.delete(id); };
    void task.then(clear, clear); return task;
  }
  private async inspectOne(api: PaseoApi, id: string, automatic: boolean, eventTimeline?: readonly AgentTimelineItem[]): Promise<Snapshot> {
    if (this.stopped || !automatic && !this.agents.has(id)) throw new Error("Refresh the session list first.");
    const epoch = this.epochs.get(id), configuration = this.configuration;
    const current = (await api.agents.ref(id).refresh())?.agent;
    if (!current || current.archivedAt || this.stopped || current.labels["session-triage.title-helper"] === "1" || "internal" in current && current.internal) throw new Error("This session is unavailable.");
    const settings = await this.preferences();
    if (current.labels["paseo.parent-agent-id"] && !settings.includeSubagents) throw new Error("This session is excluded.");
    // running은 제공자 런타임이 상주한 상태이기도 하다. 실제 턴·권한 상태를 확인한다.
    if (current.activeTurn || ["initializing", "error"].includes(current.status) || current.pendingPermissions.length) throw new Error("Check again when the session is idle.");
    await this.loadEvidence(current);
    if (this.stopped || configuration !== this.configuration || epoch !== this.epochs.get(id)) throw new Error("The session changed. Refresh and try again.");
    const revision = triageRevision(current);
    if (automatic && this.inspected.get(id)?.revision === revision) return this.snapshotValue;
    let items: readonly AgentTimelineItem[] = eventTimeline ?? [];
    let timelineError: string | undefined;
    try {
      if (!eventTimeline?.length) {
        const timeline = await api.agents.ref(id).timeline.refetch({ direction: "tail", projection: "canonical", limit: 20 });
        timelineError = timeline.error ?? undefined; items = timeline.entries.map(entry => entry.item);
      }
    } catch { timelineError = "Reply unavailable"; }
    if (this.stopped || configuration !== this.configuration || epoch !== this.epochs.get(id)) throw new Error("The session changed. Refresh and try again.");
    const latest = (await api.agents.ref(id).refresh())?.agent;
    if (!latest || latest.archivedAt || triageRevision(latest) !== revision || this.stopped || configuration !== this.configuration || epoch !== this.epochs.get(id)) throw new Error("The session changed. Refresh and try again.");
    const row = classifyAgent(latest, items, timelineError);
    this.inspected.set(id, { revision, row }); this.invalidated.delete(id);
    while (this.inspected.size > 200) this.inspected.delete(this.inspected.keys().next().value!);
    if (this.evidence && row.state !== "working" && row.state !== "idle" && row.state !== "error") {
      try { await this.evidence.write(id, { revision, state: row.state, source: row.source === "recent-message" ? "recent-message" : "fallback" }); } catch { /* Keep the in-memory result. */ }
    }
    if (this.stopped || configuration !== this.configuration || epoch !== this.epochs.get(id)) throw new Error("The session changed. Refresh and try again.");
    this.titles?.forget(id); this.titles?.request(api, id, undefined, latest);
    this.snapshotValue = { ...this.snapshotValue, rows: this.snapshotValue.rows.map(old => old.id === id ? row : old) };
    this.sort(this.snapshotValue.rows);
    return this.snapshotValue;
  }
}
