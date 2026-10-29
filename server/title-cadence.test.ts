import { describe, expect, it } from "vitest";
import { TitleCadence } from "./title-cadence";
import { triagePreferences } from "../shared/triage";

describe("성공한 응답 턴 단위 제목 갱신 주기", () => {
  it("중복된 완료 이벤트는 재계산하지 않고 초기화 뒤에도 기억한다", () => {
    const cadence = new TitleCadence();
    expect(cadence.complete("a", "turn-1")).toBe(true);
    expect(cadence.complete("a", "turn-1")).toBe(false); expect(cadence.count("a")).toBe(1);
    cadence.reset("a"); expect(cadence.complete("a", "turn-1")).toBe(false);
    expect(cadence.complete("a", "turn-2")).toBe(true); expect(cadence.count("a")).toBe(1);
  });
  it("세션별로 계산하고 종료 및 설정 변경으로 초기화할 수 있다", () => {
    const cadence = new TitleCadence(); cadence.complete("a", "1"); cadence.complete("b", "2");
    cadence.complete("a", "3"); expect(cadence.count("a")).toBe(2); expect(cadence.count("b")).toBe(1);
    cadence.forget("a"); expect(cadence.count("a")).toBe(0); expect(cadence.count("b")).toBe(1);
    cadence.clear(); expect(cadence.count("b")).toBe(0);
  });
  it("오래된 세션을 버려 메모리 사용량을 제한하며 카운터도 100까지만 유지한다", () => {
    const cadence = new TitleCadence(); cadence.complete("old", "0");
    for (let n = 0; n < 1000; n++) cadence.complete(`new-${n}`, "1");
    expect(cadence.count("old")).toBe(0);
    for (let n = 0; n < 1000; n++) cadence.complete("current", String(n));
    expect(cadence.count("current")).toBe(100);
  });
  it("갱신 주기는 기본 5턴이며 1~100의 정수만 허용한다", () => {
    expect(triagePreferences.schema.parse({}).titleUpdateEvery).toBe(5);
    expect(triagePreferences.schema.parse({ titleUpdateEvery: 1 }).titleUpdateEvery).toBe(1);
    expect(triagePreferences.schema.parse({ titleUpdateEvery: 100 }).titleUpdateEvery).toBe(100);
    for (const value of [0, -1, 101, 1.5, "5", NaN]) expect(triagePreferences.schema.safeParse({ titleUpdateEvery: value }).success).toBe(false);
  });
});
