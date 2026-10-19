import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { classifyAgent, type AgentForTriage } from "./classifier";
import { desiredTitle, desiredWorkspaceTitle } from "./triage-service";

const base: AgentForTriage = {
  id: "agent-1",
  title: "릴리스 확인",
  cwd: "/work/my-app",
  provider: "codex",
  updatedAt: "2026-10-19T08:00:00.000Z",
  status: "idle",
  pendingPermissions: [],
};

function exchange(reply: string): AgentTimelineItem[] {
  return [
    { type: "user_message", text: "진행해 주세요." },
    { type: "assistant_message", text: reply },
  ];
}

describe("classifyAgent", () => {
  it("uses red for a reported agent error even when permission is pending", () => {
    const error = classifyAgent({
      ...base,
      status: "error",
      lastError: "프로세스 종료",
      pendingPermissions: [{ kind: "tool", title: "도구 실행 승인" }],
    });
    expect(error.state).toBe("error");
    expect(error.summary).toContain("프로세스 종료");
    expect(classifyAgent({ ...base, lastError: "프로세스 종료" }).state).toBe("error");
  });

  it("gives pending permission priority over a running turn", () => {
    const row = classifyAgent({
      ...base,
      status: "running",
      activeTurn: { turnId: "turn-1", startedAt: null },
      pendingPermissions: [{ kind: "tool", title: "도구 실행 승인" }],
    });
    expect(row.state).toBe("needs-action");
    expect(row.summary).toContain("도구 실행 승인");
  });

  it("uses activeTurn rather than a running runtime as proof of work", () => {
    expect(classifyAgent({ ...base, status: "running", activeTurn: { turnId: "t", startedAt: null } }).state)
      .toBe("working");
    expect(classifyAgent({ ...base, status: "running" }, exchange("수정을 완료했습니다.")).state)
      .toBe("done");
  });

  it("distinguishes a draft awaiting a human send from external verification", () => {
    expect(classifyAgent(base, exchange("메일 초안을 작성했습니다. 검토 후 직접 보내 주세요.")).state)
      .toBe("ready-to-send");
    expect(classifyAgent(base, exchange("CI 빌드 결과를 기다리는 중입니다.")).state)
      .toBe("checking");
  });

  it("marks explicit human requests but not completed approvals as needing a response", () => {
    expect(classifyAgent(base, exchange("승인해 주세요.")).state).toBe("needs-action");
    expect(classifyAgent(base, exchange("판단해 주세요.")).state).toBe("needs-action");
    expect(classifyAgent(base, exchange("승인 완료했습니다.")).state).toBe("done");
  });

  it("keeps incomplete or unclear work visible for review", () => {
    expect(classifyAgent(base, exchange("구현했습니다. 하지만 추가 검증이 필요합니다.")).state)
      .toBe("needs-you");
    expect(classifyAgent(base, exchange("관련 파일을 확인했습니다.")).state)
      .toBe("needs-you");
    expect(classifyAgent(base, [], "timeline unavailable").state)
      .toBe("needs-you");
  });

  it("only reads the assistant response after the latest user message", () => {
    const row = classifyAgent(base, [
      ...exchange("완료했습니다."),
      { type: "user_message", text: "추가로 수정해 주세요." },
    ]);
    expect(row.state).toBe("needs-you");
  });
});

describe("desiredTitle", () => {
  it("keeps the task name and replaces an existing triage prefix", () => {
    const row = classifyAgent({ ...base, title: "🔴 릴리스 확인" }, exchange("완료했습니다."));
    expect(desiredTitle(row)).toBe("✅ 〖my-app〗릴리스 확인");
  });

  it("updates the workspace label shown in the built-in sidebar", () => {
    const row = classifyAgent({ ...base, title: "🔴 〖my-app〗릴리스 확인" }, exchange("완료했습니다."));
    expect(desiredWorkspaceTitle(row, { name: "🔴 릴리스 확인", title: "🔴 릴리스 확인" }))
      .toBe("✅ 릴리스 확인");
  });

  it("replaces the previous red review marker with orange", () => {
    const row = classifyAgent({ ...base, title: "🔴 릴리스 확인" }, exchange("추가 검증이 필요합니다."));
    expect(desiredTitle(row)).toBe("🟠 〖my-app〗릴리스 확인");
    expect(desiredWorkspaceTitle(row, { name: "🔴 릴리스 확인", title: "🔴 릴리스 확인" }))
      .toBe("🟠 릴리스 확인");
  });

  it("replaces an orange review marker when a response is requested", () => {
    const row = classifyAgent({ ...base, title: "🟠 릴리스 확인" }, exchange("검토해 주세요."));
    expect(desiredTitle(row)).toBe("❓ 〖my-app〗릴리스 확인");
    expect(desiredWorkspaceTitle(row, { name: "🟠 릴리스 확인", title: "🟠 릴리스 확인" }))
      .toBe("❓ 릴리스 확인");
  });
});
