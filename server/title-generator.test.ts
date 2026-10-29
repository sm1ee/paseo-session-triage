import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonTitleGenerator, titleAgentConfig, type TitleGeneration } from "./title-generator";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "title-generator-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function fixture() {
  const abort = new AbortController();
  const input: TitleGeneration = { title: "A long example task title for a fake provider", provider: "codex", model: "fixture-mini", thinking: "low", signal: abort.signal };
  const createAgent = vi.fn(async (options: { agentId?: string }) => ({ id: options.agentId }));
  const sendAgentMessage = vi.fn(async () => {}), deleteAgent = vi.fn(async () => {});
  const waitForFinish = vi.fn(async () => ({ status: "idle", lastMessage: '{"title":"Short task title"}' }));
  const supportsBackgroundWorkspaces = vi.fn(() => true);
  const createWorkspace = vi.fn(async (options: { workspaceId?: string }) => ({ error: null, workspace: {
    id: options.workspaceId, background: true, workspaceDirectory: directory,
  } }));
  const driver = { createAgent, createWorkspace, supportsBackgroundWorkspaces, getLastServerInfoMessage: () => ({ serverId: "fixture-server" }),
    sendAgentMessage, waitForFinish, deleteAgent } as unknown as DaemonClient;
  const generator = new DaemonTitleGenerator(async () => driver, directory);
  return { generator, driver, input, abort, createAgent, createWorkspace, supportsBackgroundWorkspaces, sendAgentMessage, waitForFinish, deleteAgent };
}
describe("별도 제목 생성 세션의 수명", () => {
  it("선택 모델의 보조 세션 하나만 만들고 자신이 만든 세션만 정리한다", async () => {
    const f = fixture(); expect(await f.generator.generate(f.input)).toBe('{"title":"Short task title"}');
    expect(f.createAgent).toHaveBeenCalledOnce();
    const options = f.createAgent.mock.calls[0][0] as Parameters<DaemonClient["createAgent"]>[0];
    expect(options.config).toMatchObject({ provider: "codex", model: "fixture-mini", mcpServers: {},
      providerOptions: { sandbox_mode: "read-only", approval_policy: "never", web_search: "disabled" } });
    expect(f.sendAgentMessage).toHaveBeenCalledOnce(); expect(f.waitForFinish).toHaveBeenCalledWith(options.agentId, 30_000);
    expect(f.deleteAgent).toHaveBeenCalledExactlyOnceWith(options.agentId); await access(options.config!.cwd);
    expect(await readdir(options.config!.cwd)).toEqual([]);
    expect(f.createWorkspace.mock.calls[0][0]).toMatchObject({ background: true });
  });
  it("백그라운드 공간을 재사용해 세션마다 새 공간을 만들지 않는다", async () => {
    const f = fixture(); await f.generator.generate(f.input); await f.generator.generate(f.input);
    expect(f.createWorkspace).toHaveBeenCalledOnce(); expect(f.createAgent).toHaveBeenCalledTimes(2);
    expect(f.deleteAgent).toHaveBeenCalledTimes(2);
  });
  it("백그라운드 API가 없는 호스트에서는 공개 세션을 대신 만들지 않는다", async () => {
    const f = fixture(); f.supportsBackgroundWorkspaces.mockReturnValue(false);
    await expect(f.generator.generate(f.input)).rejects.toThrow("background workspaces");
    expect(f.createWorkspace).not.toHaveBeenCalled(); expect(f.createAgent).not.toHaveBeenCalled();
  });
  it("백그라운드 표시가 보존되지 않은 응답에는 모델을 시작하지 않는다", async () => {
    const f = fixture(); f.createWorkspace.mockImplementationOnce(async (options) => ({ error: null,
      workspace: { id: options.workspaceId, background: false, workspaceDirectory: directory } }));
    await expect(f.generator.generate(f.input)).rejects.toThrow("workspace is unavailable"); expect(f.createAgent).not.toHaveBeenCalled();
  });
  it.each(["permission", "error", "timeout"])("생성이 %s로 끝나면 추가 메시지 없이 내부 세션을 정리한다", async (status) => {
    const f = fixture(); f.waitForFinish.mockResolvedValue({ status, lastMessage: "" });
    await expect(f.generator.generate(f.input)).rejects.toThrow("did not finish");
    expect(f.sendAgentMessage).toHaveBeenCalledOnce(); expect(f.deleteAgent).toHaveBeenCalledOnce();
  });
  it("생성 전에 취소하면 Provider를 시작하지 않는다", async () => {
    const f = fixture(); f.abort.abort(); await expect(f.generator.generate(f.input)).rejects.toThrow();
    expect(f.createAgent).not.toHaveBeenCalled();
  });
  it("세션 생성 중 끄면 생성 응답 뒤 정리하고 프롬프트는 보내지 않는다", async () => {
    const f = fixture(); let release!: (value: { id: string }) => void;
    f.createAgent.mockImplementationOnce(async (options) => {
      f.abort.abort(); return new Promise(resolve => { release = resolve; });
    });
    const pending = f.generator.generate(f.input);
    await vi.waitFor(() => expect(f.createAgent).toHaveBeenCalledOnce());
    expect(f.deleteAgent).not.toHaveBeenCalled();
    release({ id: f.createAgent.mock.calls[0][0].agentId! });
    await expect(pending).rejects.toThrow(); expect(f.sendAgentMessage).not.toHaveBeenCalled(); expect(f.deleteAgent).toHaveBeenCalledOnce();
  });
  it("정리 실패 뒤 새 모델 세션을 계속 만들지 않는다", async () => {
    const f = fixture(); f.deleteAgent.mockRejectedValue(new Error("private cleanup error"));
    await expect(f.generator.generate(f.input)).rejects.toThrow("cleanup failed");
    await expect(f.generator.generate(f.input)).rejects.toThrow("cleanup failed"); expect(f.createAgent).toHaveBeenCalledOnce();
  });
  it("지원하지 않는 Provider는 기본 모델로 대체하지 않는다", () => {
    const f = fixture(); expect(() => titleAgentConfig({ ...f.input, provider: "other" }, "/tmp")).toThrow("not supported");
  });
});
