import { basename } from "node:path";
import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { TRIAGE_DISPLAY, TRIAGE_ORDER, TRIAGE_TITLE_PREFIX, triagePreferences, type TriageRow } from "../shared/triage";
import { classifyAgent } from "./classifier";

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

function fingerprint(agent: PaseoAgent): string {
  return [
    agent.updatedAt,
    agent.status,
    agent.title,
    agent.activeTurn?.turnId ?? "",
    agent.pendingPermissions.map((request) => request.id).join(","),
    agent.lastError ?? "",
    agent.lastUserMessageAt ?? "",
  ].join("|");
}

export function desiredTitle(row: TriageRow): string {
  const original = row.title.replace(TRIAGE_TITLE_PREFIX, "").trim();
  const folder = basename(row.cwd) || "workspace";
  const task = original.startsWith("〖") ? original : `〖${folder}〗${original}`;
  return `${TRIAGE_DISPLAY[row.state].emoji} ${task}`.slice(0, 120);
}

export function desiredWorkspaceTitle(
  row: TriageRow,
  workspace: Pick<PaseoWorkspace, "name" | "title">,
): string {
  const original = (workspace.title || workspace.name).replace(TRIAGE_TITLE_PREFIX, "").trim();
  return `${TRIAGE_DISPLAY[row.state].emoji} ${original || basename(row.cwd) || "workspace"}`.slice(0, 120);
}

export class TriageService {
  private snapshotValue: Snapshot = { rows: [], checkedAt: null, truncated: false, error: null, renameErrors: [] };
  private agents = new Map<string, PaseoAgent>();
  private generation = 0;
  private pending: Promise<void> | null = null;
  private inspections = new Map<string, Promise<Snapshot>>();
  private inspected = new Map<string, { fingerprint: string; row: TriageRow }>();
  private stopped = false;
  private dirty = true;
  private lastAttempt = 0;
  private retryAt = 0;
  constructor(private readonly settings: SettingsHandle, private readonly now = Date.now) {}
  invalidate(_agentId?: string): void { this.generation++; this.dirty = true; }
  stop(): void { this.stopped = true; }
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
          if (!settings.includeSubagents && agent.labels["paseo.parent-agent-id"]) continue;
          agents.push(agent); if (agents.length >= settings.maxSessions) break;
        }
        cursor = result.pageInfo.nextCursor ?? undefined; hasMore = result.pageInfo.hasMore; pages++;
      } while (agents.length < settings.maxSessions && hasMore && cursor && pages < 3);
      if (this.stopped) return;
      // 사이드바·새로고침은 메타데이터만 읽는다. 숨은 기록 복원과 제목 변경을 하지 않는다.
      this.agents = new Map(agents.map(agent => [agent.id, agent]));
      for (const id of this.inspected.keys()) if (!this.agents.has(id)) this.inspected.delete(id);
      const rows = agents.map(agent => {
        const cached = this.inspected.get(agent.id);
        if (cached?.fingerprint === fingerprint(agent)) return { ...cached.row, title: agent.title || cached.row.title };
        this.inspected.delete(agent.id); return classifyAgent(agent);
      }); this.sort(rows);
      this.snapshotValue = { rows, checkedAt: new Date(this.now()).toISOString(),
        truncated: hasMore || agents.length >= settings.maxSessions, error: null, renameErrors: [] };
      this.dirty = generation !== this.generation; this.retryAt = 0;
    } catch {
      this.retryAt = this.now() + 60_000;
      this.snapshotValue = { ...this.snapshotValue, error: "Status unavailable. Showing the last check." };
    } finally { clearTimeout(timer); }
  }
  private sort(rows: TriageRow[]): void {
    rows.sort((a, b) => TRIAGE_ORDER.indexOf(a.state) - TRIAGE_ORDER.indexOf(b.state) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
  inspect(api: PaseoApi, id: string): Promise<Snapshot> {
    const pending = this.inspections.get(id); if (pending) return pending;
    if (this.inspections.size >= 1) return Promise.reject(new Error("Another session is being checked."));
    const task = this.inspectOne(api, id); this.inspections.set(id, task);
    const clear = () => { if (this.inspections.get(id) === task) this.inspections.delete(id); };
    void task.then(clear, clear); return task;
  }
  private async inspectOne(api: PaseoApi, id: string): Promise<Snapshot> {
    if (this.stopped || !this.agents.has(id)) throw new Error("Refresh the session list first.");
    const generation = this.generation;
    const current = (await api.agents.ref(id).refresh())?.agent;
    if (!current || current.archivedAt || this.stopped) throw new Error("This session is unavailable.");
    // running은 제공자 런타임이 상주한 상태이기도 하다. 실제 턴·권한 상태를 확인한다.
    if (current.activeTurn || ["initializing", "error"].includes(current.status) || current.pendingPermissions.length) throw new Error("Check again when the session is idle.");
    const timeline = await api.agents.ref(id).timeline.refetch({ direction: "tail", projection: "canonical", limit: 20 });
    if (timeline.error || this.stopped || generation !== this.generation) throw new Error("The session changed. Refresh and try again.");
    const latest = (await api.agents.ref(id).refresh())?.agent;
    if (!latest || fingerprint(latest) !== fingerprint(current)) throw new Error("The session changed. Refresh and try again.");
    const row = classifyAgent(latest, timeline.entries.map(entry => entry.item));
    this.inspected.set(id, { fingerprint: fingerprint(latest), row });
    this.snapshotValue = { ...this.snapshotValue, rows: this.snapshotValue.rows.map(old => old.id === id ? row : old) };
    this.sort(this.snapshotValue.rows);
    return this.snapshotValue;
  }
}
