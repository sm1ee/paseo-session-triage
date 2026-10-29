import { describe, expect, it } from "vitest";
import { cheapestThinking, filterTitleModels, type TitleModel } from "./short-titles";

describe("제목 모델 선택", () => {
  const models: TitleModel[] = [
    { provider: "claude", id: "fixture-haiku", label: "Claude · Fixture Haiku", thinkingOptions: [] },
    { provider: "codex", id: "fixture-mini", label: "Codex · Fixture Mini", thinkingOptions: [] },
    { provider: "omp", id: "other/fixture-mini", label: "OMP · Fixture Mini", thinkingOptions: [] },
  ];
  it("모델 이름과 ID를 대소문자 구분 없이 검색한다", () => {
    expect(filterTitleModels(models, "  MINI ", "").map(model => model.provider)).toEqual(["codex", "omp"]);
    expect(filterTitleModels(models, "other/fixture", "").map(model => model.provider)).toEqual(["omp"]);
  });
  it("Provider 필터와 검색어를 함께 적용한다", () => {
    expect(filterTitleModels(models, "mini", "codex")).toEqual([models[1]]);
    expect(filterTitleModels(models, "mini", "claude")).toEqual([]);
  });
  it("검색어가 없으면 전체 목록과 원래 순서를 보존한다", () => {
    expect(filterTitleModels(models, "", "")).toEqual(models);
    expect(filterTitleModels(models, "codex mini", "")).toEqual([models[1]]);
  });
  it("전체 목록을 수정하지 않고 1,339개 모델에서도 검색한다", () => {
    const many = Array.from({ length: 1339 }, (_, index) => ({ ...models[1], id: `model-${index}`, label: `Model ${index}` }));
    expect(filterTitleModels(many, "model-1338", "codex")).toEqual([many[1338]]); expect(many).toHaveLength(1339);
  });
});

describe("기본 reasoning 선택", () => {
  it.each([
    [["high", "low", "medium"], "low"],
    [["high", "medium"], "medium"],
    [["max", "xhigh", "high"], "high"],
    [["ultra", "max"], "max"],
    [["low", "minimal"], "minimal"],
    [["low", "none"], "none"],
    [["low", "off"], "off"],
    [["enabled", "disabled"], "disabled"],
    [["HIGH", "LOW"], "LOW"],
    [[], ""],
  ] as [string[], string][])("광고된 선택지 %j 중 %s를 사용한다", (ids, expected) => {
    expect(cheapestThinking(ids.map(id => ({ id })))).toBe(expected);
  });
});
