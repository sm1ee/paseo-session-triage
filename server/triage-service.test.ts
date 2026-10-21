import { describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { triagePreferences } from "../shared/triage";
import { TriageService } from "./triage-service";

function fixture(count = 1) {
  let now = Date.parse("2026-10-21T01:00:00Z");
  const agents = Array.from({ length: count }, (_, i) => ({ id: `a-${i}`, title: "작업", cwd: "/work", provider: "codex", updatedAt: new Date(now).toISOString(), lastUserMessageAt: null, status: "idle", activeTurn: null, pendingPermissions: [], labels: {}, archivedAt: null }));
  const timeline = vi.fn(async () => ({ error: null, entries: [{ item: { type: "assistant_message", text: "완료했습니다." } }] }));
  const rename = vi.fn();
  const list = vi.fn(async (_options?: unknown) => ({ entries: agents.map(agent => ({ agent })), pageInfo: { nextCursor: null, hasMore: false } }));
  const api = { agents: { list, ref: (id: string) => ({ refresh: async () => ({ agent: agents.find(a => a.id === id) }), timeline: { refetch: timeline }, setTitle: rename }) }, workspaces: { ref: () => ({ setTitle: rename }) } } as unknown as PaseoApi;
  const settings = { read: async () => ({ status: "ready", values: { renameTitles: true, includeSubagents: false, maxSessions: 40 } }) } as PluginSettings<typeof triagePreferences.schema>;
  const service = new TriageService(settings, () => now);
  return { service, api, agents, timeline, rename, list, advance: (ms: number) => now += ms };
}

describe("저부하 세션 분류", () => {
  it("40개 idle 대화에서도 자동 본문 조회나 제목 변경을 하지 않는다", async () => {
    const f = fixture(40); const result = await f.service.snapshot(f.api, true);
    expect(result.rows).toHaveLength(40); expect(result.rows.every(r => r.state === "idle")).toBe(true);
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.rename).not.toHaveBeenCalled(); f.service.stop();
  });
  it("선택한 한 대화만 읽고 metadata가 같으면 분류 결과를 유지한다", async () => {
    const f = fixture(2); await f.service.snapshot(f.api, false);
    expect((await f.service.inspect(f.api, "a-0")).rows.find(r => r.id === "a-0")?.state).toBe("done");
    expect(f.timeline).toHaveBeenCalledExactlyOnceWith({ direction: "tail", projection: "canonical", limit: 20 });
    expect((await f.service.snapshot(f.api, true)).rows.find(r => r.id === "a-0")?.state).toBe("done");
    f.agents[0]!.updatedAt = "2026-10-21T02:00:00Z";
    expect((await f.service.snapshot(f.api, true)).rows.find(r => r.id === "a-0")?.state).toBe("idle");
    expect(f.timeline).toHaveBeenCalledTimes(1); f.service.stop();
  });
  it("같은 조회는 공유하고 다른 대화의 동시 조회를 제한한다", async () => {
    const f = fixture(2); await f.service.snapshot(f.api, false);
    let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
    f.timeline.mockImplementationOnce(async () => { await gate; return { error: null, entries: [] }; });
    const first = f.service.inspect(f.api, "a-0"); expect(f.service.inspect(f.api, "a-0")).toBe(first);
    await expect(f.service.inspect(f.api, "a-1")).rejects.toThrow(/Another/);
    release(); await first; expect(f.timeline).toHaveBeenCalledOnce(); f.service.stop();
  });
  it("조회 중 lifecycle 이벤트가 오면 오래된 결과를 버린다", async () => {
    const f = fixture(); await f.service.snapshot(f.api, false);
    f.timeline.mockImplementationOnce(async () => { f.service.invalidate("a-0"); return { error: null, entries: [] }; });
    await expect(f.service.inspect(f.api, "a-0")).rejects.toThrow(/changed/); f.service.stop();
  });
  it("실행 중이거나 목록에 없는 대화는 본문을 읽지 않는다", async () => {
    const f = fixture(); await f.service.snapshot(f.api, false);
    Object.assign(f.agents[0]!, { status: "running", activeTurn: { turnId: "fixture-turn", startedAt: null } });
    await expect(f.service.inspect(f.api, "a-0")).rejects.toThrow(/idle/);
    await expect(f.service.inspect(f.api, "missing")).rejects.toThrow(/Refresh/);
    expect(f.timeline).not.toHaveBeenCalled(); f.service.stop();
  });
  it("런타임이 상주해 running으로 표시돼도 실제 턴과 권한 대기가 없으면 확인할 수 있다", async () => {
    const f = fixture(); f.agents[0]!.status = "running";
    expect((await f.service.snapshot(f.api, false)).rows[0]?.state).toBe("idle");
    expect((await f.service.inspect(f.api, "a-0")).rows[0]?.state).toBe("done");
    expect(f.timeline).toHaveBeenCalledOnce(); f.service.stop();
  });
  it("이벤트를 합치고 실패하면 60초 후 재시도한다", async () => {
    const f = fixture(); await f.service.snapshot(f.api, false);
    for (let i = 0; i < 30; i++) { f.service.invalidate("a-0"); await f.service.snapshot(f.api, false); }
    expect(f.list).toHaveBeenCalledOnce(); f.advance(10_000);
    f.list.mockRejectedValueOnce(new Error("private detail"));
    const snapshot = await f.service.snapshot(f.api, false); expect(snapshot.rows).toHaveLength(1); expect(snapshot.error).not.toContain("private");
    f.advance(10_000); await f.service.snapshot(f.api, false); expect(f.list).toHaveBeenCalledTimes(2);
    f.advance(60_000); await f.service.snapshot(f.api, false); expect(f.list).toHaveBeenCalledTimes(3); f.service.stop();
  });
  it("스캔 중 이벤트도 다음 debounce 검사에 반영한다", async () => {
    const f = fixture(); f.list.mockImplementationOnce(async () => { f.service.invalidate("a-0"); return { entries: [], pageInfo: { nextCursor: null, hasMore: false } }; });
    await f.service.snapshot(f.api, false); f.advance(10_000); await f.service.snapshot(f.api, false);
    expect(f.list).toHaveBeenCalledTimes(2); f.service.stop();
  });
});
