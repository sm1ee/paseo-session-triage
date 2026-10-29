import type { PaseoAgent } from "@getpaseo/client";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileTriageEvidence, triageRevision } from "./triage-evidence";

describe("본문 없는 분류 기록", () => {
  it("타이틀과 런타임 닫힘은 재조회하지 않고 사용자 메시지와 사용량 변화를 구분한다", () => {
    const a = { title: "Task", status: "idle", pendingPermissions: [], lastUserMessageAt: "first", lastUsage: { inputTokens: 1 } } as unknown as PaseoAgent;
    const revision = triageRevision(a);
    expect(triageRevision({ ...a, title: "✅ New title", updatedAt: "later", status: "closed" })).toBe(revision);
    expect(triageRevision({ ...a, lastUserMessageAt: "second" })).not.toBe(revision);
    expect(triageRevision({ ...a, attentionTimestamp: "later" })).not.toBe(revision);
  });
  it("재로딩 뒤 상태와 해시만 복원하며 잘못된 레코드는 무시한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "triage-evidence-test-"));
    try {
      const store = new FileTriageEvidence(directory), saved = { revision: "a".repeat(64), state: "done" as const, source: "recent-message" as const };
      expect(await store.read("private-session")).toBeNull();
      await store.write("private-session", saved);
      expect(await new FileTriageEvidence(directory).read("private-session")).toEqual(saved);
      const files = await readdir(directory); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^[a-f0-9]{64}$/u);
      const contents = await readFile(join(directory, files[0]), "utf8"); expect(Object.keys(JSON.parse(contents)).sort()).toEqual(["revision", "source", "state"]);
      await expect(store.write("private-session", { ...saved, state: "working" as never })).rejects.toThrow();
      expect(await store.read("private-session")).toEqual(saved);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
