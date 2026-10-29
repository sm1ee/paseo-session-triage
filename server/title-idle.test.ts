import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triagePreferences } from "../shared/triage";
import { IdleTitleScanner } from "./title-idle";

let scanner: IdleTitleScanner;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => { await scanner?.stop(); vi.useRealTimers(); });
function fixture(overrides: Record<string, unknown> = {}) {
  let values = triagePreferences.schema.parse({ shortenTitles: true, titleIncludeIdle: true, titleProvider: "codex", titleModel: "mini", ...overrides });
  const settings = { read: vi.fn(async () => ({ status: "ready", values })) } as unknown as PluginSettings<typeof triagePreferences.schema>;
  const agent = { id: "idle", workspaceId: "workspace", status: "closed", activeTurn: null, labels: {}, pendingPermissions: [] } as unknown as PaseoAgent;
  const list = vi.fn(async (_options: unknown) => ({ entries: [{ agent }], pageInfo: { hasMore: true, nextCursor: "next-page" } }));
  const api = { agents: { list } } as unknown as PaseoApi;
  const connect = vi.fn(async () => api), enqueue = vi.fn(async (_api: PaseoApi, _agent: PaseoAgent) => {});
  scanner = new IdleTitleScanner(settings, connect, enqueue);
  return { agent, api, list, connect, enqueue, update: (patch: Record<string, unknown>) => { values = triagePreferences.schema.parse({ ...values, ...patch }); scanner.wake(); } };
}
describe("쉬는 세션의 제한된 메타데이터 탐색", () => {
  it("꺼져 있으면 연결이나 목록 호출도 없고 설정 변경으로 활성화할 수 있다", async () => {
    const f = fixture({ titleIncludeIdle: false }); scanner.wake();
    await vi.advanceTimersByTimeAsync(30 * 60_000); expect(f.connect).not.toHaveBeenCalled();
    f.update({ titleIncludeIdle: true }); await vi.advanceTimersByTimeAsync(10_000);
    expect(f.enqueue).toHaveBeenCalledOnce();
  });
  it("한 번에 50개 메타데이터만 조회하며 15분 뒤 다음 페이지로 진행한다", async () => {
    const f = fixture(); scanner.wake(); await vi.advanceTimersByTimeAsync(10_000);
    expect(f.list).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ page: { limit: 50 } }));
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1); expect(f.list).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(f.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: { limit: 50, cursor: "next-page" } }));
  });
  it.each(["running", "permission", "error", "internal", "archived", "subagent", "helper"])("제외 상태 %s를 처리하지 않는다", async kind => {
    const f = fixture();
    if (kind === "running") f.agent.activeTurn = { turnId: "turn", startedAt: null };
    if (kind === "permission") f.agent.pendingPermissions = [{}] as PaseoAgent["pendingPermissions"];
    if (kind === "error") f.agent.status = "error";
    if (kind === "internal") Object.assign(f.agent, { internal: true });
    if (kind === "archived") f.agent.archivedAt = new Date().toISOString();
    if (kind === "subagent") f.agent.labels["paseo.parent-agent-id"] = "parent";
    if (kind === "helper") f.agent.labels["session-triage.title-helper"] = "1";
    scanner.wake(); await vi.advanceTimersByTimeAsync(10_000); expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("목록 조회 중 설정 변경이 생기면 오래된 결과를 버린다", async () => {
    const f = fixture(); let release!: (value: Awaited<ReturnType<typeof f.list>>) => void;
    f.list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    scanner.wake(); await vi.advanceTimersByTimeAsync(10_000);
    f.update({ titleIncludeIdle: false });
    release({ entries: [{ agent: f.agent }], pageInfo: { hasMore: false, nextCursor: "" } });
    await vi.advanceTimersByTimeAsync(10_000); expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("종료 뒤 목록 조회와 작업 예약이 발생하지 않는다", async () => {
    const f = fixture(); scanner.wake(); await scanner.stop(); await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(f.connect).not.toHaveBeenCalled(); expect(f.enqueue).not.toHaveBeenCalled();
  });
});
