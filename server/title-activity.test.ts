import type { PaseoAgent } from "@getpaseo/client";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { FileTitleActivity, titleActivityRevision } from "./title-activity";

describe("본문을 저장하지 않는 활동 기록", () => {
  it("제목 편집은 활동으로 세지 않고 새 메시지와 사용량 변화를 구분한다", () => {
    const agent = { lastUserMessageAt: "2026-10-29", lastUsage: { inputTokens: 100 } } as PaseoAgent;
    const revision = titleActivityRevision(agent);
    expect(titleActivityRevision({ ...agent, title: "New title", updatedAt: "later" })).toBe(revision);
    expect(titleActivityRevision({ ...agent, lastUserMessageAt: "later" })).not.toBe(revision);
    expect(titleActivityRevision({ ...agent, lastUsage: { inputTokens: 101 } } as PaseoAgent)).not.toBe(revision);
  });
  it("재로딩 뒤에도 최근 활동을 구분하며 ID와 대화 본문은 기록하지 않는다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "title-activity-test-"));
    try {
      const store = new FileTitleActivity(directory), revision = "a".repeat(64);
      expect(await store.has("private-session", revision)).toBe(false);
      await store.mark("private-session", revision);
      expect(await new FileTitleActivity(directory).has("private-session", revision)).toBe(true);
      await store.mark("private-session", "b".repeat(64));
      expect(await store.has("private-session", revision)).toBe(false);
      const files = await readdir(directory); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^[a-f0-9]{64}$/u);
      expect(await readFile(join(directory, files[0]), "utf8")).toBe("b".repeat(64));
      const file = join(directory, "file"); await writeFile(file, "preserved");
      await expect(new FileTitleActivity(file).mark("session", revision)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
