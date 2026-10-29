import type { PaseoApi, PaseoAgent } from "@getpaseo/client";
import type { PluginHookAgent, PluginSettings } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cheapestThinking, needsShortTitle, readShortTitle, titleParts } from "../shared/short-titles";
import { triagePreferences } from "../shared/triage";
import { titlePrompt, type TitleGeneration } from "./title-generator";
import { TitleShortener, titleModels } from "./title-shortener";

const long = "Refactor the authentication middleware and fix session restoration after a daemon restart";
const short = "Fix session restoration";
let service: TitleShortener;
function fixture(overrides: Record<string, unknown> = {}) {
  let values = triagePreferences.schema.parse({ shortenTitles: true, titleProvider: "codex", titleModel: "fixture-mini", ...overrides });
  const settings = { read: vi.fn(async () => ({ status: "ready", values })) } as unknown as PluginSettings<typeof triagePreferences.schema>;
  const agent = { id: "session", title: `⏳ 〖work〗${long}`, workspaceId: "workspace", labels: {}, archivedAt: null,
    status: "idle", activeTurn: null, pendingPermissions: [] } as unknown as PaseoAgent;
  const refresh = vi.fn(async () => ({ agent })), timeline = vi.fn(), list = vi.fn(), send = vi.fn();
  const entry = { provider: "codex", enabled: true, status: "ready", models: [{ id: "fixture-mini", label: "Fixture mini", thinkingOptions: [{ id: "high", label: "High" }, { id: "low", label: "Low" }] }] };
  const snapshot = vi.fn(async () => ({ entries: [entry] }));
  const api = { agents: { ref: () => ({ refresh, timeline: { refetch: timeline }, send }), list }, providers: { snapshot } } as unknown as PaseoApi;
  const budget = { claim: vi.fn(async () => true) }, generate = vi.fn(async (_input: TitleGeneration) => JSON.stringify({ title: short }));
  const apply = vi.fn(async (_api, _id, _expected, _title, valid: () => boolean) => valid());
  service = new TitleShortener(settings, budget, generate, apply);
  const event = { id: agent.id, workspaceId: agent.workspaceId, parentAgentId: null, title: agent.title, provider: "codex", cwd: "/work" } as PluginHookAgent;
  return { agent, event, api, entry, snapshot, settings, budget, generate, apply, timeline, list, send,
    update: (patch: Record<string, unknown>) => { values = triagePreferences.schema.parse({ ...values, ...patch }); service.settingsChanged(); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T03:00:00Z")); });
afterEach(() => { service?.stop(); vi.useRealTimers(); });

describe("제목 요약의 호출 및 비용 제한", () => {
  it("기본은 꺼져 있고 자동 이벤트가 모델이나 세션을 읽지 않는다", async () => {
    expect(triagePreferences.schema.parse({}).shortenTitles).toBe(false);
    const f = fixture({ shortenTitles: false }); service.onTurnEnd(f.api, f.event);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.budget.claim).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled(); expect(f.snapshot).not.toHaveBeenCalled();
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled();
  });
  it("제목만 선택한 모델에 한 번 보내고 대화나 Goal에는 메시지를 보내지 않는다", async () => {
    const f = fixture(); expect((await service.shorten(f.api, f.agent.id)).changed).toBe(true);
    expect(f.generate).toHaveBeenCalledOnce(); expect(f.generate.mock.calls[0][0]).toMatchObject({ title: f.agent.title, provider: "codex", model: "fixture-mini", thinking: "low" });
    expect(f.budget.claim).toHaveBeenCalledExactlyOnceWith("session", 5);
    expect(f.apply).toHaveBeenCalledWith(f.api, "session", f.agent.title, short, expect.any(Function));
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("자동 이벤트 1,000개를 합쳐 한 번 처리한다", async () => {
    const f = fixture(); for (let n = 0; n < 1000; n++) service.onTurnEnd(f.api, f.event);
    expect(f.generate).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).toHaveBeenCalledOnce();
  });
  it("다른 세션 자동 요약은 1분 간격으로 처리한다", async () => {
    const f = fixture(); service.onTurnEnd(f.api, f.event); service.onTurnEnd(f.api, { ...f.event, id: "next" });
    await vi.advanceTimersByTimeAsync(2000); expect(f.generate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(59_999); expect(f.generate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(f.generate).toHaveBeenCalledTimes(2);
  });
  it("이미 시도했거나 일일 상한에 도달하면 모델을 호출하지 않는다", async () => {
    const f = fixture(); f.budget.claim.mockResolvedValue(false);
    expect((await service.shorten(f.api, f.agent.id)).changed).toBe(false); expect(f.generate).not.toHaveBeenCalled();
  });
  it("짧은 제목은 모델 목록이나 예산도 읽지 않는다", async () => {
    const f = fixture(); f.agent.title = "✅ 〖work〗Short title";
    expect((await service.shorten(f.api, f.agent.id)).changed).toBe(false);
    expect(f.budget.claim).not.toHaveBeenCalled(); expect(f.snapshot).not.toHaveBeenCalled();
  });
  it.each(["archived", "subagent", "internal", "running", "permission", "error"])("제외 상태 %s에서는 모델 호출을 하지 않는다", async (kind) => {
    const f = fixture();
    if (kind === "archived") f.agent.archivedAt = new Date().toISOString();
    if (kind === "subagent") f.agent.labels["paseo.parent-agent-id"] = "parent";
    if (kind === "internal") Object.assign(f.agent, { internal: true });
    if (kind === "running") f.agent.activeTurn = { turnId: "turn", startedAt: null };
    if (kind === "permission") f.agent.pendingPermissions = [{}] as PaseoAgent["pendingPermissions"];
    if (kind === "error") f.agent.status = "error";
    await service.shorten(f.api, f.agent.id).catch(() => {}); expect(f.generate).not.toHaveBeenCalled();
  });
  it("선택 모델을 쓸 수 없으면 다른 모델로 대체하지 않는다", async () => {
    const f = fixture({ titleModel: "missing" }); await expect(service.shorten(f.api, "session")).rejects.toThrow("unavailable");
    expect(f.generate).not.toHaveBeenCalled(); expect(f.budget.claim).not.toHaveBeenCalled();
  });
  it("실패한 자동 호출은 다시 시도하지 않는다", async () => {
    const f = fixture(); f.generate.mockRejectedValue(new Error("private provider error")); service.onTurnEnd(f.api, f.event);
    await vi.advanceTimersByTimeAsync(2000); await vi.advanceTimersByTimeAsync(600_000);
    expect(f.generate).toHaveBeenCalledOnce(); expect(service.status()).not.toContain("private");
  });
  it("끄는 즉시 진행 중 결과를 버리고 제목을 쓰지 않는다", async () => {
    const f = fixture(); let release!: (text: string) => void;
    f.generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = service.shorten(f.api, "session"); await vi.advanceTimersByTimeAsync(0);
    f.update({ shortenTitles: false }); expect(f.generate.mock.calls[0][0].signal.aborted).toBe(true);
    release(JSON.stringify({ title: short })); expect((await pending).changed).toBe(false); expect(f.apply).not.toHaveBeenCalled();
  });
  it("처리 중 다른 요청은 시작하지 않는다", async () => {
    const f = fixture(); let release!: (text: string) => void;
    f.generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = service.shorten(f.api, "session"); await vi.advanceTimersByTimeAsync(0);
    await expect(service.shorten(f.api, "other")).rejects.toThrow("Another title");
    release(JSON.stringify({ title: short })); await pending; expect(f.generate).toHaveBeenCalledOnce();
  });
  it("생성 중 보관된 세션은 결과를 적용하지 않는다", async () => {
    const f = fixture(); let release!: (text: string) => void;
    f.generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = service.shorten(f.api, "session"); await vi.advanceTimersByTimeAsync(0);
    service.forget("session"); expect(f.generate.mock.calls[0][0].signal.aborted).toBe(true);
    release(JSON.stringify({ title: short })); expect((await pending).changed).toBe(false); expect(f.apply).not.toHaveBeenCalled();
  });
  it("호출 시간이 지나면 중단하고 늦게 온 결과를 버린다", async () => {
    const f = fixture(); let release!: (text: string) => void;
    f.generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = service.shorten(f.api, "session"); await vi.advanceTimersByTimeAsync(45_000);
    expect(f.generate.mock.calls[0][0].signal.aborted).toBe(true);
    release(JSON.stringify({ title: short })); expect((await pending).changed).toBe(false); expect(f.apply).not.toHaveBeenCalled();
  });
  it("종료 시 보조 작업 정리가 끝난 뒤 연결을 닫을 수 있게 기다린다", async () => {
    const f = fixture(); let release!: (text: string) => void;
    f.generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = service.shorten(f.api, "session"); await vi.advanceTimersByTimeAsync(0);
    const drained = vi.fn(); const stopping = service.stop().then(drained); await vi.advanceTimersByTimeAsync(0);
    expect(drained).not.toHaveBeenCalled();
    release(JSON.stringify({ title: short })); await pending; await stopping;
    expect(drained).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled();
  });
  it("잘못된 응답은 원래 제목을 유지하고 재요청하지 않는다", async () => {
    const f = fixture(); f.generate.mockResolvedValue("This is not JSON");
    expect((await service.shorten(f.api, "session")).changed).toBe(false); expect(f.apply).not.toHaveBeenCalled(); expect(f.generate).toHaveBeenCalledOnce();
  });
  it("모델 목록은 활성화된 지원 Provider의 선택 가능한 모델만 반환한다", async () => {
    const f = fixture(); f.entry.enabled = false; expect((await titleModels(f.api)).models).toEqual([]);
  });
});

describe("요약 입력과 결과", () => {
  it("아이콘과 폴더를 비용 없는 접두사로 분리한다", () => {
    expect(titleParts("❓ 〖repo〗  Fix   auth")).toEqual({ prefix: "❓ 〖repo〗  ", body: "Fix auth" });
    expect(needsShortTitle("⏳ 〖very-long-project-name-that-does-not-count〗Short task")).toBe(false);
    expect(cheapestThinking([{ id: "high" }, { id: "low" }])).toBe("low");
  });
  it("모델에 보낼 제목은 최대 320 유니코드 문자로 제한한다", () => {
    const prompt = titlePrompt(`⏳ 〖repo〗${"가".repeat(5000)}`);
    expect(prompt.match(/가/gu)?.length).toBe(320); expect(prompt).not.toContain("repo"); expect(prompt.length).toBeLessThan(650);
  });
  it.each(['{"title":"x"}', '{"title":"line\\nline"}', '{"title":"✅ New title"}', '{"title":"https://example.test"}', '{}', '{"title":42}'])("부적절한 결과를 거부한다: %s", response => {
    expect(readShortTitle(response, long)).toBeNull();
  });
  it("40자를 초과한 결과를 거부한다", () => { expect(readShortTitle(JSON.stringify({ title: "x".repeat(41) }), long)).toBeNull(); });
});
