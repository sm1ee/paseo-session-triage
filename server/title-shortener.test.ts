import type { PaseoApi, PaseoAgent } from "@getpaseo/client";
import type { PluginHookAgent, PluginSettings } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cheapestThinking, needsShortTitle, readShortTitle, titleParts } from "../shared/short-titles";
import { triagePreferences } from "../shared/triage";
import { titlePrompt, type TitleGeneration } from "./title-generator";
import { TitleShortener, titleModels } from "./title-shortener";
import type { ActiveTitleGoal } from "./title-goal";

const long = "Refactor the authentication middleware and fix session restoration after a daemon restart";
const short = "Fix session restoration";
let service: TitleShortener;
function fixture(overrides: Record<string, unknown> = {}) {
  let values = triagePreferences.schema.parse({ shortenTitles: true, titleProvider: "codex", titleModel: "fixture-mini", ...overrides });
  const settings = { read: vi.fn(async () => ({ status: "ready", values })) } as unknown as PluginSettings<typeof triagePreferences.schema>;
  const agent = { id: "session", title: `⏳ 〖work〗${long}`, workspaceId: "workspace", labels: {}, archivedAt: null,
    status: "idle", activeTurn: null, pendingPermissions: [] } as unknown as PaseoAgent;
  const refresh = vi.fn(async () => ({ agent })), timeline = vi.fn(async () => ({ error: null as string | null,
    entries: [{ item: { type: "assistant_message" as const, text: "Fix mobile scrolling" } }] })), list = vi.fn(), send = vi.fn();
  const entry = { provider: "codex", enabled: true, status: "ready", models: [{ id: "fixture-mini", label: "Fixture mini", thinkingOptions: [{ id: "high", label: "High" }, { id: "low", label: "Low" }] }] };
  const snapshot = vi.fn(async () => ({ entries: [entry] }));
  const api = { agents: { ref: () => ({ refresh, timeline: { refetch: timeline }, send }), list }, providers: { snapshot } } as unknown as PaseoApi;
  const budget = { claim: vi.fn(async () => true) }, generate = vi.fn(async (_input: TitleGeneration) => JSON.stringify({ title: short }));
  const apply = vi.fn(async (_api, _id, _expected, _title, valid: () => boolean) => valid());
  const readGoal = vi.fn(async (): Promise<ActiveTitleGoal | null> => null);
  service = new TitleShortener(settings, budget, generate, apply, Date.now, async () => true, readGoal);
  const event = { id: agent.id, workspaceId: agent.workspaceId, parentAgentId: null, title: agent.title, provider: "codex", cwd: "/work" } as PluginHookAgent;
  return { agent, event, api, entry, snapshot, settings, budget, generate, apply, timeline, list, send, readGoal,
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
  it("기존 설정은 40자 제한을 유지하고 자동으로 짧은 제목을 호출하지 않는다", async () => {
    expect(triagePreferences.schema.parse({}).titleLongOnly).toBe(true);
    const f = fixture(); f.agent.title = "Fix the session restoration bug";
    service.onTurnEnd(f.api, { ...f.event, title: f.agent.title });
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).not.toHaveBeenCalled(); expect(f.budget.claim).not.toHaveBeenCalled();
    expect(f.snapshot).not.toHaveBeenCalled();
  });
  it("길이 제한을 끄면 40자 이하 제목도 수동으로 요약한다", async () => {
    const f = fixture({ titleLongOnly: false }); f.agent.title = "✅ 〖work〗Fix the session restoration bug";
    expect((await service.shorten(f.api, f.agent.id)).changed).toBe(true);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.budget.claim).toHaveBeenCalledExactlyOnceWith("session", 5);
    expect(f.apply).toHaveBeenCalledWith(f.api, "session", f.agent.title, short, expect.any(Function));
  });
  it("길이 조건으로 건너뛴 제목이 다음 긴 제목을 1분 대기시키지 않는다", async () => {
    const f = fixture();
    service.onTurnEnd(f.api, { ...f.event, id: "short-session", title: "Short title" });
    service.onTurnEnd(f.api, f.event);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.generate).toHaveBeenCalledOnce(); expect(f.budget.claim).toHaveBeenCalledExactlyOnceWith("session", 5);
  });
  it("설정을 바꾸면 캐시된 길이 조건도 바뀌고 다음 완료 이벤트에서 짧은 제목을 처리한다", async () => {
    const f = fixture(); f.agent.title = "Fix the session restoration bug";
    service.onTurnEnd(f.api, { ...f.event, title: f.agent.title });
    await vi.advanceTimersByTimeAsync(2000); expect(f.generate).not.toHaveBeenCalled();
    f.update({ titleLongOnly: false }); service.onTurnEnd(f.api, { ...f.event, title: f.agent.title });
    await vi.advanceTimersByTimeAsync(60_000); expect(f.generate).toHaveBeenCalledOnce();
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled();
  });
  it("길이 제한을 꺼도 더 짧아질 수 없는 제목과 더 긴 결과에는 비용이나 변경을 추가하지 않는다", async () => {
    const f = fixture({ titleLongOnly: false }); f.agent.title = "✅ 〖work〗abcd";
    expect((await service.shorten(f.api, f.agent.id)).changed).toBe(false);
    expect(f.generate).not.toHaveBeenCalled(); expect(f.budget.claim).not.toHaveBeenCalled();
    f.agent.title = "Fix session bug";
    expect((await service.shorten(f.api, f.agent.id)).changed).toBe(false);
    expect(f.generate).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled();
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
  it("기존 설정은 대화 읽기 없이 제목만 전송하는 모드를 유지한다", async () => {
    expect(triagePreferences.schema.parse({}).titleSource).toBe("title");
    const f = fixture(); await service.shorten(f.api, "session", [{ role: "assistant", text: "Do not send this" }]);
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.generate.mock.calls[0][0].context).toBeUndefined();
    expect(f.readGoal).not.toHaveBeenCalled();
  });
  it("대화 모드는 짧은 goal 제목도 처리하고 예산 확보 뒤 최근 6개 항목만 조회한다", async () => {
    const f = fixture({ titleSource: "conversation" }); f.agent.title = "goal";
    expect((await service.shorten(f.api, "session")).changed).toBe(true);
    expect(f.timeline).toHaveBeenCalledExactlyOnceWith({ direction: "tail", projection: "canonical", limit: 6 });
    expect(f.generate.mock.calls[0][0].context).toEqual([{ role: "assistant", text: "Fix mobile scrolling" }]);
    expect(f.budget.claim.mock.invocationCallOrder[0]).toBeLessThan(f.timeline.mock.invocationCallOrder[0]);
    expect(f.budget.claim.mock.invocationCallOrder[0]).toBeLessThan(f.readGoal.mock.invocationCallOrder[0]);
    expect(f.list).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it("완료 이벤트에 대화가 있으면 제한된 발췌를 재사용하고 추가 타임라인 조회를 하지 않는다", async () => {
    const f = fixture({ titleSource: "conversation", titleUpdateEvery: 1 }); f.agent.title = "goal";
    service.onTurnEnd(f.api, { ...f.event, title: "goal" }, [{ type: "assistant_message", text: "Fix mobile scrolling" }]);
    expect(f.timeline).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).toHaveBeenCalledOnce(); expect(f.timeline).not.toHaveBeenCalled();
  });
  it("대화 모드도 한도를 넘었으면 메시지를 읽거나 모델을 호출하지 않는다", async () => {
    const f = fixture({ titleSource: "conversation" }); f.budget.claim.mockResolvedValue(false);
    expect((await service.shorten(f.api, "session")).changed).toBe(false);
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    expect(f.readGoal).not.toHaveBeenCalled();
  });
  it("대화 내용이 없거나 읽기 실패면 제목만으로 대신 호출하지 않는다", async () => {
    const f = fixture({ titleSource: "conversation" }); f.timeline.mockResolvedValue({ error: null, entries: [] });
    expect((await service.shorten(f.api, "session")).changed).toBe(false); expect(f.generate).not.toHaveBeenCalled();
    f.timeline.mockResolvedValue({ error: "unavailable", entries: [] });
    await expect(service.shorten(f.api, "session")).rejects.toThrow("recent messages"); expect(f.generate).not.toHaveBeenCalled();
  });
  it("대화 기반 생성 도중 새 사용자 메시지가 오면 결과를 버린다", async () => {
    const f = fixture({ titleSource: "conversation" });
    f.generate.mockImplementationOnce(async () => { f.agent.lastUserMessageAt = "2026-10-29T03:01:00Z"; return JSON.stringify({ title: short }); });
    expect((await service.shorten(f.api, "session")).changed).toBe(false); expect(f.apply).not.toHaveBeenCalled();
  });
  it("수동 재생성은 반복 허용을 명시하고 같은 일일 예산을 사용한다", async () => {
    const f = fixture({ titleSource: "conversation" });
    expect((await service.shorten(f.api, "session", [], true)).changed).toBe(true);
    expect(f.budget.claim).toHaveBeenCalledExactlyOnceWith("session", 5, true);
  });
  it("기본 5턴마다 반복 생성하며 그전에는 Goal이나 대화를 읽지 않는다", async () => {
    const f = fixture({ titleSource: "conversation" });
    for (let n = 1; n <= 4; n++) { service.forget("session"); service.onTurnEnd(f.api, f.event, [], `turn-${n}`); }
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).not.toHaveBeenCalled(); expect(f.readGoal).not.toHaveBeenCalled(); expect(f.timeline).not.toHaveBeenCalled();
    service.onTurnEnd(f.api, f.event, [], "turn-5"); await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).toHaveBeenCalledOnce(); expect(f.budget.claim).toHaveBeenCalledExactlyOnceWith("session", 5, true);
    service.onTurnEnd(f.api, f.event, [], "turn-5");
    for (let n = 6; n <= 9; n++) { service.forget("session"); service.onTurnEnd(f.api, f.event, [], `turn-${n}`); }
    await vi.advanceTimersByTimeAsync(60_000); expect(f.generate).toHaveBeenCalledOnce();
    service.onTurnEnd(f.api, f.event, [], "turn-10"); await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).toHaveBeenCalledTimes(2);
  });
  it("주기 변경은 카운터를 초기화하고 새로 지정한 턴 수를 기다린다", async () => {
    const f = fixture({ titleSource: "conversation", titleUpdateEvery: 5 });
    service.onTurnEnd(f.api, f.event, [], "1"); service.onTurnEnd(f.api, f.event, [], "2");
    await vi.advanceTimersByTimeAsync(2000); f.update({ titleUpdateEvery: 2 });
    service.onTurnEnd(f.api, f.event, [], "3"); await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).not.toHaveBeenCalled();
    service.onTurnEnd(f.api, f.event, [], "4"); await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).toHaveBeenCalledOnce();
  });
  it("수동 생성 뒤에는 다시 전체 자동 갱신 주기를 기다린다", async () => {
    const f = fixture({ titleSource: "conversation", titleUpdateEvery: 3 });
    service.onTurnEnd(f.api, f.event, [], "1"); service.onTurnEnd(f.api, f.event, [], "2");
    await vi.advanceTimersByTimeAsync(2000); await service.shorten(f.api, "session", [], true);
    for (let n = 3; n <= 4; n++) service.onTurnEnd(f.api, f.event, [], String(n));
    await vi.advanceTimersByTimeAsync(2000); expect(f.generate).toHaveBeenCalledOnce();
    service.onTurnEnd(f.api, f.event, [], "5"); await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).toHaveBeenCalledTimes(2);
  });
  it("실행 중인 Goal은 최근 대화보다 우선하며 메시지 조회를 생략한다", async () => {
    const f = fixture({ titleSource: "conversation" });
    f.readGoal.mockResolvedValue({ objective: "Fix mobile model selection", revision: "goal-v1" });
    expect((await service.shorten(f.api, "session", [{ role: "assistant", text: "Other recent work" }])).changed).toBe(true);
    expect(f.generate.mock.calls[0][0]).toMatchObject({ goal: "Fix mobile model selection", context: undefined });
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.readGoal).toHaveBeenCalledTimes(2);
  });
  it("Goal이 생성 중 멈추거나 바뀌면 이전 결과는 적용하지 않는다", async () => {
    const f = fixture({ titleSource: "conversation" });
    f.readGoal.mockResolvedValueOnce({ objective: "Fix mobile model selection", revision: "goal-v1" }).mockResolvedValue(null);
    expect((await service.shorten(f.api, "session")).changed).toBe(false);
    expect(f.apply).not.toHaveBeenCalled(); expect(f.timeline).not.toHaveBeenCalled();
  });
  it("최근 대화로 생성하는 사이 Goal이 실행되면 대화 기반 결과는 버린다", async () => {
    const f = fixture({ titleSource: "conversation" });
    f.readGoal.mockResolvedValueOnce(null).mockResolvedValue({ objective: "New goal", revision: "goal-v2" });
    expect((await service.shorten(f.api, "session")).changed).toBe(false); expect(f.apply).not.toHaveBeenCalled();
  });
  it("주기적 생성 실패는 같은 완료 이벤트로 재시도하지 않고 다음 주기를 기다린다", async () => {
    const f = fixture({ titleSource: "conversation", titleUpdateEvery: 2 });
    f.generate.mockRejectedValueOnce(new Error("capacity"));
    service.onTurnEnd(f.api, f.event, [], "1"); service.onTurnEnd(f.api, f.event, [], "2");
    await vi.advanceTimersByTimeAsync(2000); expect(f.generate).toHaveBeenCalledOnce();
    service.onTurnEnd(f.api, f.event, [], "2"); service.onTurnEnd(f.api, f.event, [], "3");
    await vi.advanceTimersByTimeAsync(120_000); expect(f.generate).toHaveBeenCalledOnce();
    service.onTurnEnd(f.api, f.event, [], "4"); await vi.advanceTimersByTimeAsync(2000);
    expect(f.generate).toHaveBeenCalledTimes(2);
  });
  it("같은 네이티브 Goal의 다음 턴이 바로 실행돼도 중단 없이 제목을 생성한다", async () => {
    const f = fixture({ titleSource: "conversation" });
    f.readGoal.mockResolvedValue({ objective: "Fix mobile model selection", revision: "goal-v1" });
    f.agent.activeTurn = { turnId: "goal-turn-1", startedAt: null };
    let release!: (text: string) => void;
    f.generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = service.shorten(f.api, "session"); await vi.advanceTimersByTimeAsync(0);
    expect(f.generate).toHaveBeenCalledOnce();
    f.agent.activeTurn = { turnId: "goal-turn-2", startedAt: null }; service.turnStarted("session");
    expect(f.generate.mock.calls[0][0].signal.aborted).toBe(false);
    release(JSON.stringify({ title: short })); expect((await pending).changed).toBe(true);
    expect(f.send).not.toHaveBeenCalled(); expect(f.timeline).not.toHaveBeenCalled();
  });
  it("다음 Goal 턴이 주기 처리 전에 시작되어도 예약된 작업을 잃지 않는다", async () => {
    const f = fixture({ titleSource: "conversation", titleUpdateEvery: 1 });
    f.readGoal.mockResolvedValue({ objective: "Fix mobile model selection", revision: "goal-v1" });
    service.onTurnEnd(f.api, f.event, [], "finished-goal-turn");
    f.agent.activeTurn = { turnId: "next-goal-turn", startedAt: null }; service.turnStarted("session");
    await vi.advanceTimersByTimeAsync(2000); expect(f.generate).toHaveBeenCalledOnce(); expect(f.apply).toHaveBeenCalledOnce();
  });
  it("Goal 없는 실행 중 대화에는 제목 생성 모델이나 본문 조회를 추가하지 않는다", async () => {
    const f = fixture({ titleSource: "conversation" }); f.agent.activeTurn = { turnId: "running", startedAt: null };
    expect((await service.shorten(f.api, "session")).changed).toBe(false);
    expect(f.generate).not.toHaveBeenCalled(); expect(f.timeline).not.toHaveBeenCalled();
  });
  it("대화 기반 생성 중 새 턴이 시작되면 해당 발췌 결과를 취소한다", async () => {
    const f = fixture({ titleSource: "conversation" }); let release!: (text: string) => void;
    f.generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = service.shorten(f.api, "session"); await vi.advanceTimersByTimeAsync(0);
    service.turnStarted("session"); expect(f.generate.mock.calls[0][0].signal.aborted).toBe(true);
    release(JSON.stringify({ title: short })); expect((await pending).changed).toBe(false); expect(f.apply).not.toHaveBeenCalled();
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
