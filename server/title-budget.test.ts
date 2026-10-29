import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileTitleBudget } from "./title-budget";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "title-budget-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
describe("지속되는 제목 요청 예산", () => {
  it("재로딩과 날짜 변경 뒤에도 같은 세션을 다시 청구하지 않는다", async () => {
    const first = new FileTitleBudget(directory, () => Date.parse("2026-10-29T00:00:00Z"));
    expect(await first.claim("private-session", 5)).toBe(true);
    const reload = new FileTitleBudget(directory, () => Date.parse("2026-10-30T00:00:00Z"));
    expect(await reload.claim("private-session", 5)).toBe(false);
    const files = await readdir(directory);
    expect(files.join()).not.toContain("private-session");
    for (const file of files) expect(await readFile(join(directory, file), "utf8")).toBe("");
  });
  it("재로딩이 겹쳐도 일일 상한을 초과하지 않는다", async () => {
    const first = new FileTitleBudget(directory), second = new FileTitleBudget(directory);
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).claim(`session-${index}`, 5)));
    expect(claims.filter(Boolean)).toHaveLength(5);
  });
  it("한도 때문에 보내지 못한 세션은 다음 날 시도할 수 있다", async () => {
    const first = new FileTitleBudget(directory, () => Date.parse("2026-10-29T00:00:00Z"));
    expect(await first.claim("first", 1)).toBe(true); expect(await first.claim("next", 1)).toBe(false);
    const tomorrow = new FileTitleBudget(directory, () => Date.parse("2026-10-30T00:00:00Z"));
    expect(await tomorrow.claim("next", 1)).toBe(true);
  });
  it("예산을 쓸 수 없으면 오류를 반환해 호출을 막는다", async () => {
    const file = join(directory, "not-a-directory"); await writeFile(file, "preserved");
    await expect(new FileTitleBudget(file).claim("session", 5)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("preserved");
  });
  it("명시적인 수동 재생성도 같은 일일 상한을 쓰며 자동 시도 기록은 유지한다", async () => {
    const budget = new FileTitleBudget(directory);
    expect(await budget.claim("session", 2)).toBe(true);
    expect(await budget.claim("session", 2)).toBe(false);
    expect(await budget.claim("session", 2, true)).toBe(true);
    expect(await budget.claim("session", 2, true)).toBe(false);
    expect(await budget.claim("session", 3)).toBe(false);
    expect(await budget.claim("session", 3, true)).toBe(true);
  });
});
