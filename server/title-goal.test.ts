import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { describe, expect, it, vi } from "vitest";
import { activeTitleGoal, titleGoalReader } from "./title-goal";
import { titlePrompt } from "./title-generator";

const active = { id: "session", visible: true, state: "active", key: "goal-key", objective: "Fix mobile model selection",
  source: "codex", nativeAction: "pause", nativeReconnect: false, nativeStart: false, holdReason: null };
describe("실행 중인 Goal만 제목으로 우선 사용", () => {
  it("검증된 실행 상태와 목표 본문이 모두 있어야 채택하고 본문은 600자로 제한한다", () => {
    expect(activeTitleGoal(active, "session")?.objective).toBe(active.objective);
    expect(Array.from(activeTitleGoal({ ...active, objective: "가".repeat(4000) }, "session")!.objective)).toHaveLength(600);
    expect(activeTitleGoal(active, "other")).toBeNull();
    expect(activeTitleGoal({ ...active, objective: "" }, "session")).toBeNull();
    expect(activeTitleGoal({ ...active, key: null }, "session")).toBeNull();
  });
  it.each(["paused", "blocked", "limited", "complete", "cleared", "unknown"])("%s Goal은 우선하지 않는다", state => {
    expect(activeTitleGoal({ ...active, state }, "session")).toBeNull();
  });
  it.each([
    { nativeAction: "resume" }, { nativeReconnect: true }, { nativeStart: true }, { source: "timeline" }, { visible: false },
    { holdReason: "user_stop" }, { holdReason: "input" }, { holdReason: "daemon_restart" }, { holdReason: "goal_limit" },
  ])("active 표시만 남은 중단/불확실 상태 %j는 무시한다", patch => {
    expect(activeTitleGoal({ ...active, ...patch }, "session")).toBeNull();
  });
  it("복구 플러그인의 자동 계속 기능과 네이티브 Goal 실행 상태를 혼동하지 않는다", () => {
    expect(activeTitleGoal({ ...active, holdReason: "goal_disabled" }, "session")?.objective).toBe(active.objective);
  });
  it("기존 복구 어댑터의 읽기 미리보기만 요청하고 이력 검사나 제어 요청은 하지 않는다", async () => {
    const invokePluginRpc = vi.fn(async () => active);
    const reader = titleGoalReader(async () => ({ invokePluginRpc }) as unknown as DaemonClient);
    expect((await reader("session"))?.objective).toBe(active.objective);
    expect(invokePluginRpc).toHaveBeenCalledExactlyOnceWith("session-recovery", "recovery.goal.control",
      { id: "session", fresh: true, inspect: false, preview: true });
  });
  it("플러그인이 없거나 읽기에 실패하면 최근 대화로 전환할 수 있도록 null을 반환한다", async () => {
    const reader = titleGoalReader(async () => { throw new Error("not installed"); });
    expect(await reader("session")).toBeNull();
  });
  it("느린 Goal 조회는 3.5초까지만 기다린다", async () => {
    vi.useFakeTimers();
    try {
      const reader = titleGoalReader(async () => ({ invokePluginRpc: () => new Promise(() => {}) }) as unknown as DaemonClient);
      const pending = reader("session"); await vi.advanceTimersByTimeAsync(3500); expect(await pending).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("활성 목표 프롬프트가 최근 대화나 기존 goal 지시문보다 우선한다", () => {
    const prompt = titlePrompt("Old generic title", [{ role: "assistant", text: "Other work" }], active.objective);
    expect(prompt).toContain("currently active goal"); expect(prompt).toContain(active.objective);
    expect(prompt).not.toContain("Other work"); expect(prompt).not.toContain("Old generic title");
  });
});
