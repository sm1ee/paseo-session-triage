import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { triagePreferences } from "../shared/triage";
import { TriageService } from "./triage-service";
import { triageRevision, type TriageEvidence, type TriageEvidenceStore } from "./triage-evidence";

const services: TriageService[] = [];
afterEach(() => { services.splice(0).forEach(s => s.stop()); });

function fixture(count = 1, store?: TriageEvidenceStore, withTitles = false) {
  let now = Date.parse("2026-10-21T01:00:00Z");
  const agents = Array.from({ length: count }, (_, i) => ({ id: `a-${i}`, title: "작업", cwd: "/work", provider: "codex", updatedAt: new Date(now).toISOString(), lastUserMessageAt: null, status: "idle", activeTurn: null, pendingPermissions: [], labels: {}, archivedAt: null, workspaceId: "workspace" } as unknown as PaseoAgent));
  const timeline = vi.fn(async () => ({ error: null, entries: [{ item: { type: "assistant_message", text: "완료했습니다." } }] }));
  const rename = vi.fn(async (id: string, title: string) => { agents.find(a => a.id === id)!.title = title; });
  const list = vi.fn(async (_options?: unknown) => ({ entries: agents.map(agent => ({ agent })), pageInfo: { nextCursor: null, hasMore: false } }));
  const api = { agents: { list, ref: (id: string) => ({ refresh: async () => ({ agent: agents.find(a => a.id === id) }), timeline: { refetch: timeline }, setTitle: rename }) }, workspaces: { ref: () => ({ refresh: async () => ({ title: "Personal workspace", name: "Personal workspace" }), setTitle: vi.fn() }) } } as unknown as PaseoApi;
  const settings = { read: async () => ({ status: "ready", values: { renameTitles: true, includeSubagents: false, maxSessions: 40 } }) } as PluginSettings<typeof triagePreferences.schema>;
  const service = new TriageService(settings, () => now, withTitles ? rename : undefined, store); services.push(service);
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
    expect((await f.service.snapshot(f.api, true)).rows.find(r => r.id === "a-0")?.state).toBe("done");
    f.agents[0]!.lastUserMessageAt = "2026-10-21T02:00:00Z";
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
  it.each(["running", "closed"] as const)("런타임 상태가 %s여도 실제 턴과 권한 대기가 없으면 확인할 수 있다", async (status) => {
    const f = fixture(); f.agents[0]!.status = status;
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

describe("변경된 답변만 직렬로 자동 분류", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("최초 목록은 즉시 반환하고 3초 간격으로 한 세션씩 읽는다", async () => {
    const f = fixture(3); const initial = await f.service.snapshot(f.api, true);
    expect(initial.rows.every(r => r.state === "idle")).toBe(true); expect(f.timeline).not.toHaveBeenCalled();
    expect(f.service.checkingReplies()).toBe(true);
    await vi.advanceTimersByTimeAsync(3000); expect(f.timeline).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999); expect(f.timeline).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3001); expect(f.timeline).toHaveBeenCalledTimes(3);
    expect(f.service.checkingReplies()).toBe(false);
    const result = await f.service.snapshot(f.api, true); expect(result.rows.every(r => r.state === "done")).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000); expect(f.timeline).toHaveBeenCalledTimes(3);
  });
  it("제목과 아이콘 갱신, refresh 반복은 추가 조회나 분류 초기화를 일으키지 않는다", async () => {
    const f = fixture(1, undefined, true); await f.service.snapshot(f.api, true);
    await vi.advanceTimersByTimeAsync(4000); expect(f.agents[0].title).toMatch(/^✅/u);
    f.agents[0].title = "✅ User rename"; f.agents[0].updatedAt = "later";
    for (let i = 0; i < 10; i++) await f.service.snapshot(f.api, true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.timeline).toHaveBeenCalledOnce(); expect((await f.service.snapshot(f.api, true)).rows[0].state).toBe("done");
  });
  it("런타임 종료 이벤트만으로 같은 답변을 다시 읽지 않는다", async () => {
    const f = fixture(); await f.service.snapshot(f.api, true); await vi.advanceTimersByTimeAsync(3000);
    f.agents[0].status = "closed"; f.service.activity(f.api, "a-0", undefined, undefined, true);
    await vi.advanceTimersByTimeAsync(3000); expect(f.timeline).toHaveBeenCalledOnce();
    expect((await f.service.snapshot(f.api, true)).rows[0].state).toBe("done");
  });
  it("0.13의 빈 완료 이벤트는 새 답변을 한 번 읽고 다른 세션 이벤트로 취소되지 않는다", async () => {
    const f = fixture(2); await f.service.snapshot(f.api, true); await vi.advanceTimersByTimeAsync(6000);
    f.timeline.mockImplementationOnce(async () => { f.service.invalidate("a-1"); return { error: null, entries: [{ item: { type: "assistant_message", text: "please review the result" } }] }; });
    f.service.activity(f.api, "a-0", []); await vi.advanceTimersByTimeAsync(3000);
    expect(f.timeline).toHaveBeenCalledTimes(3);
    expect((await f.service.snapshot(f.api, true)).rows.find(r => r.id === "a-0")?.state).toBe("needs-action");
  });
  it("이전 SDK 이벤트 본문이 있으면 본문 재조회 없이 사용한다", async () => {
    const f = fixture(); f.service.activity(f.api, "a-0", [{ type: "assistant_message", text: "All checks passed." }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.timeline).not.toHaveBeenCalled();
    expect((await f.service.snapshot(f.api, true)).rows[0].state).toBe("done");
  });
  it("활동이 없는 세션의 분류는 재로딩 후 저장된 상태로 복원한다", async () => {
    const entries = new Map<string, TriageEvidence>();
    const store = { read: vi.fn(async (id: string) => entries.get(id) ?? null), write: vi.fn(async (id: string, e: TriageEvidence) => { entries.set(id, e); }) };
    const f = fixture(1, store); await f.service.snapshot(f.api, true); await vi.advanceTimersByTimeAsync(3000); f.service.stop();
    const next = fixture(1, store); const result = await next.service.snapshot(next.api, true);
    expect(result.rows[0].state).toBe("done"); await vi.advanceTimersByTimeAsync(60_000); expect(next.timeline).not.toHaveBeenCalled();
    expect(JSON.stringify([...entries])).not.toContain("완료했습니다");
  });
  it("오류 및 빈 답변도 같은 활동으로 반복 조회하지 않고 수동 확인으로 재시도 가능하다", async () => {
    const f = fixture(); f.timeline.mockRejectedValueOnce(new Error("provider error with private detail"));
    await f.service.snapshot(f.api, true); await vi.advanceTimersByTimeAsync(3000);
    const result = await f.service.snapshot(f.api, true); expect(result.rows[0].state).toBe("needs-you");
    expect(result.rows[0].summary).not.toContain("private detail");
    await vi.advanceTimersByTimeAsync(60_000); expect(f.timeline).toHaveBeenCalledOnce();
    expect((await f.service.inspect(f.api, "a-0")).rows[0].state).toBe("done"); expect(f.timeline).toHaveBeenCalledTimes(2);
  });
  it.each(["active", "permission", "error", "helper", "internal", "archived"])("%s 상태는 자동 대화 조회에서 제외한다", async kind => {
    const f = fixture(); const a = f.agents[0];
    if (kind === "active") a.activeTurn = { turnId: "active", startedAt: null };
    if (kind === "permission") a.pendingPermissions = [{ id: "permission", kind: "tool" }] as PaseoAgent["pendingPermissions"];
    if (kind === "error") a.status = "error";
    if (kind === "helper") a.labels["session-triage.title-helper"] = "1";
    if (kind === "internal") Object.assign(a, { internal: true });
    if (kind === "archived") a.archivedAt = "now";
    f.service.activity(f.api, a.id, []); await vi.advanceTimersByTimeAsync(3000); expect(f.timeline).not.toHaveBeenCalled();
  });
  it("조회 중 시작된 새 턴 또는 보관은 오래된 결과와 아이콘 쓰기를 막는다", async () => {
    const f = fixture(1, undefined, true); let release!: (v: Awaited<ReturnType<typeof f.timeline>>) => void;
    f.timeline.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await f.service.snapshot(f.api, true); await vi.advanceTimersByTimeAsync(3000);
    f.agents[0].activeTurn = { turnId: "new", startedAt: null }; f.service.activity(f.api, "a-0");
    release({ error: null, entries: [{ item: { type: "assistant_message", text: "All checks passed." } }] });
    await vi.advanceTimersByTimeAsync(3000); expect(f.agents[0].title).not.toMatch(/^✅/u);
    f.service.archived("a-0"); await vi.advanceTimersByTimeAsync(3000); expect(f.timeline).toHaveBeenCalledOnce();
  });
  it("본문 조회가 느려도 다른 세션을 동시에 조회하지 않고 수동 요청도 공유한다", async () => {
    const f = fixture(2); let release!: (v: Awaited<ReturnType<typeof f.timeline>>) => void;
    f.timeline.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await f.service.snapshot(f.api, true); await vi.advanceTimersByTimeAsync(3000);
    const shared = f.service.inspect(f.api, "a-0"); await vi.advanceTimersByTimeAsync(30_000);
    expect(f.timeline).toHaveBeenCalledOnce(); await expect(f.service.inspect(f.api, "a-1")).rejects.toThrow("Another");
    release({ error: null, entries: [] }); await shared; await vi.advanceTimersByTimeAsync(3000); expect(f.timeline).toHaveBeenCalledTimes(2);
  });
  it("설정 변경과 종료 뒤 진행 중 결과는 저장하거나 아이콘에 적용하지 않는다", async () => {
    const f = fixture(); f.timeline.mockImplementationOnce(async () => { f.service.settingsChanged(); return { error: null, entries: [] }; });
    await f.service.snapshot(f.api, true); await vi.advanceTimersByTimeAsync(3000);
    expect(f.service.checkingReplies()).toBe(false); f.service.stop();
    await vi.advanceTimersByTimeAsync(60_000); expect(f.timeline).toHaveBeenCalledOnce();
  });
});
