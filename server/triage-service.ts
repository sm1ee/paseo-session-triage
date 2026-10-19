import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { TRIAGE_DISPLAY, TRIAGE_ORDER, triagePreferences, type TriageRow } from "../shared/triage";
import { classifyAgent } from "./classifier";

const execFile = promisify(execFileCallback);
const SCAN_INTERVAL_MS = 15 * 60_000;
const TIMELINE_LIMIT = 24;
const TITLE_PREFIX = /^[🔴📤👀⏳✅]\s*/u;
type Preferences = ReturnType<typeof triagePreferences.schema.parse>;
type SettingsHandle = PluginSettings<typeof triagePreferences.schema>;

interface Snapshot {
  rows: TriageRow[];
  checkedAt: string | null;
  truncated: boolean;
  error: string | null;
  renameErrors: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fingerprint(agent: PaseoAgent): string {
  return [
    agent.updatedAt,
    agent.status,
    agent.title,
    agent.activeTurn?.turnId ?? "",
    agent.pendingPermissions.map((request) => request.id).join(","),
    agent.lastError ?? "",
  ].join("|");
}

export function desiredTitle(row: TriageRow): string {
  const original = row.title.replace(TITLE_PREFIX, "").trim();
  const folder = basename(row.cwd) || "workspace";
  const task = original.startsWith("〖") ? original : `〖${folder}〗${original}`;
  return `${TRIAGE_DISPLAY[row.state].emoji} ${task}`.slice(0, 120);
}

function cliPath(): string {
  if (process.env.PASEO_CLI_PATH) return process.env.PASEO_CLI_PATH;
  const macApp = "/Applications/Paseo.app/Contents/Resources/bin/paseo";
  return existsSync(macApp) ? macApp : "paseo";
}

async function renameAgent(agentId: string, title: string): Promise<void> {
  const args = ["agent", "update", agentId, "--name", title, "--json"];
  if (process.env.PASEO_HOME) args.push("--home", process.env.PASEO_HOME);
  await execFile(cliPath(), args, { timeout: 10_000, maxBuffer: 64 * 1024 });
}

export class TriageService {
  private readonly settings: SettingsHandle;
  private snapshotValue: Snapshot = {
    rows: [],
    checkedAt: null,
    truncated: false,
    error: null,
    renameErrors: [],
  };
  private fingerprints = new Map<string, string>();
  private generation = 0;
  private pending: Promise<void> | null = null;
  private stopped = false;

  constructor(settings: SettingsHandle) {
    this.settings = settings;
  }

  invalidate(agentId?: string): void {
    this.generation++;
    this.snapshotValue = { ...this.snapshotValue, checkedAt: null };
    if (agentId) this.fingerprints.delete(agentId);
    else this.fingerprints.clear();
  }

  async snapshot(api: PaseoApi, refresh: boolean): Promise<Snapshot> {
    const previous = this.snapshotValue.checkedAt ? Date.parse(this.snapshotValue.checkedAt) : 0;
    if (refresh || !previous || Date.now() - previous >= SCAN_INTERVAL_MS) {
      await this.runScan(api, refresh);
    } else if (this.pending) {
      await this.pending;
    }
    return this.snapshotValue;
  }

  stop(): void {
    this.stopped = true;
  }

  private async preferences(): Promise<Preferences> {
    const state = await this.settings.read();
    if (state.status === "ready") return state.values;
    console.error("session-triage settings invalid:", state.error);
    return triagePreferences.schema.parse({});
  }

  private async runScan(api: PaseoApi, forceRecentMessages: boolean): Promise<void> {
    if (this.stopped) return;
    if (this.pending) return this.pending;
    const task = this.performScan(api, forceRecentMessages);
    this.pending = task;
    try {
      await task;
    } finally {
      if (this.pending === task) this.pending = null;
    }
  }

  private async performScan(api: PaseoApi, forceRecentMessages: boolean): Promise<void> {
    const generation = this.generation;
    try {
      const settings = await this.preferences();
      const agents: PaseoAgent[] = [];
      let cursor: string | undefined;
      let hasMore = false;
      let pages = 0;
      do {
        const result = await api.agents.list({
          scope: "active",
          filter: { includeArchived: false },
          sort: [{ key: "updated_at", direction: "desc" }],
          page: { limit: Math.min(100, settings.maxSessions * 2), ...(cursor ? { cursor } : {}) },
        });
        for (const entry of result.entries) {
          const agent = entry.agent;
          if (!settings.includeSubagents && agent.labels["paseo.parent-agent-id"]) continue;
          agents.push(agent);
          if (agents.length >= settings.maxSessions) break;
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
        hasMore = result.pageInfo.hasMore;
        pages++;
      } while (agents.length < settings.maxSessions && hasMore && cursor && pages < 3);

      const oldRows = new Map(this.snapshotValue.rows.map((row) => [row.id, row]));
      const nextFingerprints = new Map<string, string>();
      const rows: TriageRow[] = [];
      for (let start = 0; start < agents.length; start += 2) {
        const batch = agents.slice(start, start + 2);
        const results = await Promise.all(
          batch.map(async (agent) => {
            const nextFingerprint = fingerprint(agent);
            nextFingerprints.set(agent.id, nextFingerprint);
            const previous = oldRows.get(agent.id);
            if (!forceRecentMessages && previous && this.fingerprints.get(agent.id) === nextFingerprint) {
              return previous;
            }

            const needsTimeline =
              agent.pendingPermissions.length === 0 &&
              !agent.activeTurn &&
              agent.status !== "initializing" &&
              agent.status !== "error";
            if (!needsTimeline) return classifyAgent(agent);
            try {
              const timeline = await api.agents.ref(agent.id).timeline.refetch({
                direction: "tail",
                projection: "canonical",
                limit: TIMELINE_LIMIT,
              });
              if (timeline.error) return classifyAgent(agent, [], timeline.error);
              const items: AgentTimelineItem[] = timeline.entries.map((entry) => entry.item);
              return classifyAgent(agent, items);
            } catch (error) {
              return classifyAgent(agent, [], errorText(error));
            }
          }),
        );
        rows.push(...results);
      }

      rows.sort((a, b) => {
        const priority = TRIAGE_ORDER.indexOf(a.state) - TRIAGE_ORDER.indexOf(b.state);
        return priority || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });

      const renameErrors: string[] = [];
      if (settings.renameTitles) {
        let renamed = 0;
        for (const row of rows) {
          if (renamed >= 10) break;
          const desired = desiredTitle(row);
          if (desired === row.title) continue;
          try {
            await renameAgent(row.id, desired);
            row.title = desired;
            renamed++;
          } catch (error) {
            renameErrors.push(`${row.id.slice(0, 8)}: ${errorText(error)}`);
          }
        }
      }

      this.fingerprints = generation === this.generation ? nextFingerprints : new Map();
      this.snapshotValue = {
        rows,
        checkedAt: generation === this.generation ? new Date().toISOString() : null,
        truncated: hasMore || agents.length >= settings.maxSessions,
        error: null,
        renameErrors,
      };
    } catch (error) {
      this.snapshotValue = {
        ...this.snapshotValue,
        checkedAt: new Date().toISOString(),
        error: errorText(error),
      };
      console.error("session-triage scan failed:", errorText(error));
    }
  }
}
