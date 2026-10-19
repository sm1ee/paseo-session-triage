import { describe, expect, it } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { triagePreferences } from "../shared/triage";
import { TriageService } from "./triage-service";

describe("TriageService", () => {
  it("fetches only a recent timeline and reuses it while the agent is unchanged", async () => {
    let timelineReads = 0;
    const agent = {
      id: "agent-1",
      title: "작업",
      cwd: "/work/app",
      provider: "codex",
      updatedAt: "2026-10-19T08:00:00.000Z",
      status: "idle",
      activeTurn: null,
      pendingPermissions: [],
      labels: {},
      lastError: undefined,
    };
    const api = {
      agents: {
        list: async () => ({
          entries: [{ agent }],
          pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
        }),
        ref: () => ({
          timeline: {
            refetch: async (options: { direction: string; limit: number }) => {
              expect(options.direction).toBe("tail");
              expect(options.limit).toBeLessThanOrEqual(24);
              timelineReads++;
              return {
                error: null,
                entries: [
                  { item: { type: "user_message", text: "진행" } },
                  { item: { type: "assistant_message", text: "수정을 완료했습니다." } },
                ],
              };
            },
          },
        }),
      },
    } as unknown as PaseoApi;
    const settings = {
      read: async () => ({
        status: "ready" as const,
        revision: "1",
        values: { renameTitles: false, includeSubagents: false, maxSessions: 20 },
      }),
    } as PluginSettings<typeof triagePreferences.schema>;
    const service = new TriageService(settings);
    try {
      const first = await service.snapshot(api, false);
      expect(first.rows[0]?.state).toBe("done");
      expect(first.error).toBeNull();
      await service.snapshot(api, false);
      expect(timelineReads).toBe(1);
      service.invalidate(agent.id);
      await service.snapshot(api, false);
      expect(timelineReads).toBe(2);
    } finally {
      service.stop();
    }
  });

  it("rescans when an agent event arrives during a scan", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const firstListStarted = new Promise<void>((resolve) => { started = resolve; });
    let listCalls = 0;
    const agent = {
      id: "agent-2",
      title: "작업",
      cwd: "/work/app",
      provider: "codex",
      updatedAt: "2026-10-19T08:00:00.000Z",
      status: "idle",
      activeTurn: null,
      pendingPermissions: [],
      labels: {},
    };
    const api = {
      agents: {
        list: async () => {
          listCalls++;
          if (listCalls === 1) {
            started();
            await gate;
          }
          return { entries: [{ agent }], pageInfo: { nextCursor: null, hasMore: false } };
        },
        ref: () => ({ timeline: { refetch: async () => ({ error: null, entries: [] }) } }),
      },
    } as unknown as PaseoApi;
    const settings = {
      read: async () => ({
        status: "ready" as const,
        revision: "1",
        values: { renameTitles: false, includeSubagents: false, maxSessions: 20 },
      }),
    } as PluginSettings<typeof triagePreferences.schema>;
    const service = new TriageService(settings);
    try {
      const first = service.snapshot(api, false);
      await firstListStarted;
      service.invalidate(agent.id);
      release();
      expect((await first).checkedAt).toBeNull();
      expect((await service.snapshot(api, false)).checkedAt).not.toBeNull();
      expect(listCalls).toBe(2);
    } finally {
      service.stop();
    }
  });

  it("uses the highest-priority state and avoids repeated workspace renames", async () => {
    let workspaceName = "작업";
    let renameCount = 0;
    const agent = {
      id: "agent-3",
      title: "🔴 〖app〗작업",
      cwd: "/work/app",
      workspaceId: "wks-3",
      provider: "codex",
      updatedAt: "2026-10-19T08:00:00.000Z",
      status: "error",
      activeTurn: null,
      pendingPermissions: [],
      labels: {},
      lastError: "오류",
    };
    const workingAgent = {
      ...agent,
      id: "agent-4",
      title: "⏳ 〖app〗보조",
      status: "running",
      activeTurn: { turnId: "turn-4", startedAt: null },
      lastError: undefined,
    };
    const reviewAgent = {
      ...agent,
      id: "agent-5",
      title: "🟠 〖app〗검토",
      status: "running",
      activeTurn: null,
      pendingPermissions: [{ id: "permission-5", kind: "tool", title: "검토 필요" }],
      lastError: undefined,
    };
    let includeError = true;
    const api = {
      agents: {
        list: async () => ({
          entries: [workingAgent, reviewAgent, ...(includeError ? [agent] : [])].map((item) => ({ agent: item })),
          pageInfo: { nextCursor: null, hasMore: false },
        }),
      },
      workspaces: {
        ref: () => ({
          refresh: async () => ({ name: workspaceName, title: workspaceName, archivingAt: null }),
          setTitle: async (title: string) => {
            workspaceName = title;
            renameCount++;
            return { title };
          },
        }),
      },
    } as unknown as PaseoApi;
    const settings = {
      read: async () => ({
        status: "ready" as const,
        revision: "1",
        values: { renameTitles: true, includeSubagents: false, maxSessions: 20 },
      }),
    } as PluginSettings<typeof triagePreferences.schema>;
    const service = new TriageService(settings);
    try {
      const snapshot = await service.snapshot(api, true);
      expect(snapshot.error).toBeNull();
      expect(workspaceName).toBe("🔴 작업");
      await service.snapshot(api, true);
      expect(renameCount).toBe(1);
      includeError = false;
      await service.snapshot(api, true);
      expect(workspaceName).toBe("🟠 작업");
      expect(renameCount).toBe(2);
    } finally {
      service.stop();
    }
  });
});
