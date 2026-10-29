import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { PluginSettings } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triagePreferences } from "../shared/triage";
import { TitleSync } from "./title-sync";

let sync: TitleSync;
function fixture(enabled = true) {
  const agent = { id: "fixture", title: "🟠 Task", workspaceId: "workspace", cwd: "/work", provider: "omp", updatedAt: "2026-10-23T00:00:00Z",
    lastUserMessageAt: null, status: "running", activeTurn: { turnId: "turn", startedAt: null }, pendingPermissions: [], labels: {}, archivedAt: null } as unknown as PaseoAgent;
  const workspace = { name: "🟠 Task", title: "🟠 Task", archivingAt: null };
  const refresh = vi.fn(async () => ({ agent })), timeline = vi.fn(), list = vi.fn();
  const rename = vi.fn(async (_id: string, title: string) => { agent.title = title; });
  const workspaceRefresh = vi.fn(async () => workspace), workspaceRename = vi.fn(async (title: string | null) => { workspace.title = title!; });
  const api = { agents: { ref: () => ({ refresh, timeline: { refetch: timeline } }), list },
    workspaces: { ref: () => ({ refresh: workspaceRefresh, setTitle: workspaceRename }) } } as unknown as PaseoApi;
  const settings = { read: vi.fn(async () => ({ status: "ready", values: { renameTitles: enabled, includeSubagents: false, maxSessions: 40 } })) } as unknown as PluginSettings<typeof triagePreferences.schema>;
  const accepted = vi.fn(), failed = vi.fn(); sync = new TitleSync(settings, rename, accepted, failed);
  return { agent, workspace, refresh, timeline, list, rename, workspaceRefresh, workspaceRename, api, settings, accepted, failed };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { sync?.stop(); vi.useRealTimers(); });

describe("이벤트 기반 제목 아이콘 갱신", () => {
  it("요약 결과가 준비되는 동안 바뀐 사용자 제목은 보존한다", async () => {
    const f = fixture(); f.agent.title = "User renamed this session";
    expect(await sync.shorten(f.api, f.agent.id, "Original long title", "Short task", () => true)).toBe(false);
    expect(f.rename).not.toHaveBeenCalled(); expect(f.workspaceRename).not.toHaveBeenCalled();
  });
  it("요약은 현재 상태 아이콘과 폴더를 보존하고 별도로 이름붙인 워크스페이스를 건드리지 않는다", async () => {
    const f = fixture(false); f.agent.title = "❓ 〖work〗Original long title"; f.workspace.title = "Personal workspace";
    expect(await sync.shorten(f.api, f.agent.id, "⏳ 〖work〗Original long title", "Short task", () => true)).toBe(true);
    expect(f.rename).toHaveBeenCalledExactlyOnceWith(f.agent.id, "❓ 〖work〗Short task"); expect(f.workspaceRename).not.toHaveBeenCalled();
  });
  it("기존 세션 제목과 일치하는 워크스페이스 이름만 함께 줄인다", async () => {
    const f = fixture(); f.agent.title = "⏳ 〖work〗Original long title"; f.workspace.title = "❓ Original long title";
    expect(await sync.shorten(f.api, f.agent.id, f.agent.title, "Short task", () => true)).toBe(true);
    expect(f.workspaceRename).toHaveBeenCalledExactlyOnceWith("❓ Short task");
  });
  it("설정 변경이나 종료로 취소된 요약은 제목을 쓰지 않는다", async () => {
    const f = fixture(); expect(await sync.shorten(f.api, f.agent.id, f.agent.title!, "Short task", () => false)).toBe(false);
    expect(f.refresh).not.toHaveBeenCalled(); expect(f.rename).not.toHaveBeenCalled();
  });
  it("오래된 🟠를 실제 실행 턴의 ⏳로 바꾸며 전체 목록이나 본문을 조회하지 않는다", async () => {
    const f = fixture(); sync.request(f.api, f.agent.id);
    expect(f.rename).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(300);
    expect(f.rename).toHaveBeenCalledExactlyOnceWith("fixture", "⏳ 〖work〗Task");
    expect(f.workspaceRename).toHaveBeenCalledExactlyOnceWith("⏳ Task");
    expect(f.list).not.toHaveBeenCalled(); expect(f.timeline).not.toHaveBeenCalled();
  });
  it("이벤트 1,000개를 합치고 변경 없는 메타데이터는 다시 조회하거나 쓰지 않는다", async () => {
    const f = fixture(); for (let n = 0; n < 1000; n++) sync.request(f.api, f.agent.id);
    await vi.advanceTimersByTimeAsync(300); expect(f.rename).toHaveBeenCalledOnce(); expect(f.refresh).toHaveBeenCalledTimes(2);
    for (let n = 0; n < 1000; n++) sync.request(f.api, f.agent.id, undefined, f.agent);
    await vi.advanceTimersByTimeAsync(1000); expect(f.refresh).toHaveBeenCalledTimes(2); expect(f.workspaceRename).toHaveBeenCalledOnce();
  });
  it("완료 이벤트에 실린 최근 메시지로 분류하고 타임라인 복원은 요청하지 않는다", async () => {
    const f = fixture(); f.agent.status = "idle"; f.agent.activeTurn = null;
    const items = [{ type: "assistant_message", text: "All checks passed. The work is complete." }] as AgentTimelineItem[];
    sync.request(f.api, f.agent.id, items); await vi.advanceTimersByTimeAsync(300);
    expect(f.rename.mock.calls[0]?.[1]).toMatch(/^✅/u); expect(f.workspaceRename.mock.calls[0]?.[0]).toMatch(/^✅/u);
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.accepted.mock.calls[0]?.[1].state).toBe("done");
  });
  it("완료 직후 닫힘 이벤트가 합쳐져도 완료 메시지를 잃지 않는다", async () => {
    const f = fixture(); f.agent.status = "closed"; f.agent.activeTurn = null;
    const items = [{ type: "assistant_message", text: "All checks passed. The work is complete." }] as AgentTimelineItem[];
    sync.request(f.api, f.agent.id, items); sync.request(f.api, f.agent.id);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.rename.mock.calls[0]?.[1]).toMatch(/^✅/u);
    expect(f.timeline).not.toHaveBeenCalled();
  });
  it("0.13의 빈 종료 타임라인은 유휴 메타데이터만 반영하고 본문을 추가 조회하지 않는다", async () => {
    const f = fixture(); f.agent.status = "idle"; f.agent.activeTurn = null;
    sync.request(f.api, f.agent.id, []); await vi.advanceTimersByTimeAsync(300);
    expect(f.rename.mock.calls[0]?.[1]).toMatch(/^○/u);
    expect(f.accepted.mock.calls[0]?.[1].state).toBe("idle");
    expect(f.timeline).not.toHaveBeenCalled(); expect(f.list).not.toHaveBeenCalled();
  });
  it("보관된 세션의 이전 오류가 다른 세션의 워크스페이스 표시를 덮지 않는다", async () => {
    const f = fixture(); f.agent.status = "error"; f.agent.activeTurn = null;
    sync.request(f.api, f.agent.id); await vi.advanceTimersByTimeAsync(300);
    expect(f.workspace.title).toBe("🔴 Task");
    sync.forget(f.agent.id); f.agent.id = "another"; f.agent.title = "Another task"; f.agent.status = "running";
    f.agent.activeTurn = { turnId: "next", startedAt: null };
    sync.request(f.api, f.agent.id); await vi.advanceTimersByTimeAsync(300);
    expect(f.workspace.title).toBe("⏳ Task");
  });
  it("보관 전에 시작된 메타데이터 응답으로 제목을 나중에 쓰지 않는다", async () => {
    const f = fixture(); let release!: (value: { agent: PaseoAgent }) => void;
    f.refresh.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    sync.request(f.api, f.agent.id); await vi.advanceTimersByTimeAsync(300);
    sync.forget(f.agent.id); release({ agent: f.agent }); await vi.advanceTimersByTimeAsync(0);
    expect(f.rename).not.toHaveBeenCalled(); expect(f.workspaceRename).not.toHaveBeenCalled();
  });
  it("권한 요청은 실행 표시보다 우선하고 해소 후 다시 실행 상태로 돌아간다", async () => {
    const f = fixture(); f.agent.pendingPermissions = [{ id: "approval", kind: "tool", title: "Approve tool" }] as PaseoAgent["pendingPermissions"];
    sync.request(f.api, f.agent.id); await vi.advanceTimersByTimeAsync(300);
    expect(f.workspace.title).toBe("❓ Task");
    f.agent.pendingPermissions = []; sync.request(f.api, f.agent.id); await vi.advanceTimersByTimeAsync(300);
    expect(f.workspace.title).toBe("⏳ Task");
  });
  it("비활성 설정과 제외된 하위 대화는 읽거나 이름을 바꾸지 않는다", async () => {
    const f = fixture(false); sync.request(f.api, f.agent.id); await vi.advanceTimersByTimeAsync(300);
    expect(f.refresh).not.toHaveBeenCalled(); expect(f.rename).not.toHaveBeenCalled();
    sync.stop(); const child = fixture(); sync.request(child.api, child.agent.id, undefined, undefined, true);
    await vi.advanceTimersByTimeAsync(300); expect(child.refresh).not.toHaveBeenCalled();
  });
  it("연속된 다른 세션 변경도 한 번에 하나만 처리한다", async () => {
    const f = fixture(); for (let n = 0; n < 20; n++) sync.request(f.api, `fixture-${n}`);
    await vi.advanceTimersByTimeAsync(300); expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.rename).toHaveBeenCalledOnce(); expect(f.workspaceRename).toHaveBeenCalledOnce();
  });
  it("이전 읽기 중 새 이벤트나 종료가 발생하면 오래된 제목을 쓰지 않는다", async () => {
    const f = fixture(); let release!: (value: { agent: PaseoAgent }) => void;
    f.refresh.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    sync.request(f.api, f.agent.id); await vi.advanceTimersByTimeAsync(300);
    sync.request(f.api, f.agent.id); release({ agent: f.agent }); await vi.advanceTimersByTimeAsync(0);
    expect(f.rename).not.toHaveBeenCalled(); sync.stop(); await vi.advanceTimersByTimeAsync(1000); expect(f.rename).not.toHaveBeenCalled();
  });
  it("제목 쓰기가 실패하면 빠른 반복 대신 60초 대기하고 다시 시도한다", async () => {
    const f = fixture(); f.rename.mockRejectedValueOnce(new Error("private failure"));
    sync.request(f.api, f.agent.id); await vi.advanceTimersByTimeAsync(300);
    expect(f.failed).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(59_000); expect(f.rename).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000); expect(f.rename).toHaveBeenCalledTimes(2); expect(f.workspace.title).toBe("⏳ Task");
  });
});
