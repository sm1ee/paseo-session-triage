import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { TRIAGE_ORDER, triagePreferences, type TriageRow } from "../shared/triage";
import { classifyAgent } from "./classifier";
import { desiredTitle, desiredWorkspaceTitle } from "./titles";

type Settings = PluginSettings<typeof triagePreferences.schema>;
interface Work { api: PaseoApi; id: string; timeline?: readonly AgentTimelineItem[]; seed?: PaseoAgent }
function signature(a: PaseoAgent): string {
  return JSON.stringify([a.status, a.activeTurn?.turnId, a.pendingPermissions.map((r) => r.id), a.lastUserMessageAt, a.lastError, a.title]);
}
export class TitleSync {
  private queue = new Map<string, Work>();
  private workspaces = new Map<string, Map<string, TriageRow>>();
  private applied = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private working = false;
  private activeId: string | null = null;
  private activeCancelled = false;
  private stopped = false;
  private generation = 0;
  private config: ReturnType<typeof triagePreferences.schema.parse> | null = null;
  private retryAt = 0;
  constructor(private readonly settings: Settings, private readonly rename: (id: string, title: string) => Promise<void>,
    private readonly accepted: (agent: PaseoAgent, row: TriageRow) => void, private readonly failed: () => void, private readonly now = Date.now) {}
  request(api: PaseoApi, id: string, timeline?: readonly AgentTimelineItem[], seed?: PaseoAgent, subagent = false): void {
    if (this.stopped || this.config?.renameTitles === false) return;
    if ((subagent || seed?.labels["paseo.parent-agent-id"]) && !this.config?.includeSubagents) return;
    if (seed && !timeline && this.applied.get(id) === signature(seed)) return;
    if (!this.queue.has(id) && this.queue.size >= 200) return;
    // Paseo 0.13 sends an empty timeline on turn end. Missing chat evidence is
    // metadata-only, not proof of unfinished work; do not restore a conversation.
    const recent = timeline?.length ? timeline.slice(-20) : undefined;
    this.queue.set(id, { api, id, timeline: recent ?? this.queue.get(id)?.timeline, seed });
    this.schedule();
  }
  forget(id: string): void {
    this.queue.delete(id); this.applied.delete(id);
    if (this.activeId === id) this.activeCancelled = true;
    for (const [workspaceId, rows] of this.workspaces) {
      rows.delete(id); if (!rows.size) this.workspaces.delete(workspaceId);
    }
  }
  settingsChanged(): void { this.generation++; this.config = null; this.applied.clear(); }
  stop(): void { this.stopped = true; this.queue.clear(); clearTimeout(this.timer); }
  private schedule(): void {
    if (this.stopped || this.working || this.timer || !this.queue.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.next(); }, Math.max(300, this.retryAt - this.now()));
  }
  private async next(): Promise<void> {
    if (this.stopped || this.working) return;
    const work = this.queue.values().next().value; if (!work) return;
    this.queue.delete(work.id); this.working = true; this.activeId = work.id; this.activeCancelled = false;
    try { await this.apply(work); this.retryAt = 0; }
    catch {
      this.retryAt = this.now() + 60_000; this.failed();
      if (!this.stopped && !this.queue.has(work.id) && this.queue.size < 200) this.queue.set(work.id, work);
    }
    finally { this.working = false; this.activeId = null; this.schedule(); }
  }
  private async apply(work: Work): Promise<void> {
    const generation = this.generation, valid = () => !this.stopped && !this.activeCancelled && generation === this.generation && !this.queue.has(work.id);
    if (!this.config) { const s = await this.settings.read(); this.config = s.status === "ready" ? s.values : triagePreferences.schema.parse({}); }
    if (!this.config.renameTitles || !valid()) return;
    const handle = work.api.agents.ref(work.id);
    let agent = (await handle.refresh())?.agent;
    if (!agent || agent.archivedAt || "internal" in agent && agent.internal || !agent.workspaceId || !valid()) return;
    const subagent = !!agent.labels["paseo.parent-agent-id"];
    if (subagent && !this.config.includeSubagents) return;
    if (!work.timeline && this.applied.get(agent.id) === signature(agent)) return;
    let row = classifyAgent(agent, work.timeline);
    const desired = desiredTitle(row);
    if (desired !== agent.title) {
      if (!valid()) return;
      await this.rename(agent.id, desired);
      if (!valid()) return;
      agent = (await handle.refresh())?.agent;
      if (!agent || agent.archivedAt || !valid()) return;
      row = classifyAgent(agent, work.timeline);
      if (desiredTitle(row) !== agent.title) { this.request(work.api, work.id, work.timeline); return; }
    }
    this.accepted(agent, row);
    if (!subagent) {
      const workspaceId = agent.workspaceId!;
      let states = this.workspaces.get(workspaceId);
      if (!states) { states = new Map(); this.workspaces.set(workspaceId, states); }
      states.set(agent.id, row);
      while (states.size > 40) states.delete(states.keys().next().value!);
      while (this.workspaces.size > 100) this.workspaces.delete(this.workspaces.keys().next().value!);
      const highest = [...states.values()].sort((a, b) => TRIAGE_ORDER.indexOf(a.state) - TRIAGE_ORDER.indexOf(b.state))[0]!;
      const workspace = work.api.workspaces.ref(workspaceId), current = await workspace.refresh();
      if (!current || current.archivingAt || !valid()) return;
      const title = desiredWorkspaceTitle(highest, current);
      if (current.title !== title && current.name !== title) await workspace.setTitle(title);
    }
    this.applied.set(agent.id, signature(agent));
    while (this.applied.size > 200) this.applied.delete(this.applied.keys().next().value!);
  }
}
