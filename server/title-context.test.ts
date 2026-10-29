import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { titleContext } from "./title-context";
import { titlePrompt } from "./title-generator";
import { readShortTitle } from "../shared/short-titles";

describe("현재 작업 제목의 제한된 대화 입력", () => {
  it("최근 사용자 요청과 이후 답변만 선택하고 도구 및 reasoning은 제외한다", () => {
    const items = [
      { type: "user_message", text: "/goal continue until done" },
      { type: "assistant_message", text: "An older task" },
      { type: "user_message", text: "Fix mobile model picker scrolling" },
      { type: "reasoning", text: "private reasoning" },
      { type: "error", message: "private tool failure" },
      { type: "assistant_message", text: "Added a bounded scrolling model dialog." },
    ] as AgentTimelineItem[];
    expect(titleContext(items)).toEqual([
      { role: "user", text: "Fix mobile model picker scrolling" },
      { role: "assistant", text: "Added a bounded scrolling model dialog." },
    ]);
  });
  it("최근 6개 항목 밖의 내용은 읽지 않고 역할별 최대 600 유니코드 문자만 보낸다", () => {
    const items = [{ type: "user_message", text: "old private text" },
      ...Array.from({ length: 4 }, () => ({ type: "reasoning", text: "excluded" })),
      { type: "user_message", text: "가".repeat(5000) },
      { type: "assistant_message", text: "😀".repeat(5000) }] as AgentTimelineItem[];
    const context = titleContext(items);
    expect(context.map(item => Array.from(item.text).length)).toEqual([600, 600]);
    expect(JSON.stringify(context)).not.toContain("old private text");
  });
  it("다음 사용자 요청 이전의 답변을 새 작업 설명으로 섞지 않는다", () => {
    expect(titleContext([{ type: "assistant_message", text: "Old task" }, { type: "user_message", text: "New task" }]))
      .toEqual([{ role: "user", text: "New task" }]);
  });
  it("코드 블록은 발췌에서 제외하고 도구/추론만 있으면 입력이 비어 있다", () => {
    expect(titleContext([{ type: "user_message", text: "Fix UI ```private code``` scrolling" }])[0].text).toBe("Fix UI [code omitted] scrolling");
    expect(titleContext([{ type: "reasoning", text: "private" }])).toEqual([]);
  });
  it("기존 goal 제목이 짧아도 실제 작업 제목을 허용하고 기존 제목 모드는 더 긴 결과를 거부한다", () => {
    const response = JSON.stringify({ title: "Fix mobile model selection" });
    expect(readShortTitle(response, "goal", "conversation")).toBe("Fix mobile model selection");
    expect(readShortTitle(response, "goal")).toBeNull();
    expect(readShortTitle('{"title":null}', "goal", "conversation")).toBeNull();
    expect(readShortTitle('{"title":"goal"}', "goal", "conversation")).toBeNull();
  });
  it("대화 프롬프트는 실제 작업을 제목으로 요청하고 실행이나 도구 사용을 금지한다", () => {
    const prompt = titlePrompt("/goal continue", [{ role: "assistant", text: "Fix mobile scrolling" }]);
    expect(prompt).toContain("concrete work"); expect(prompt).toContain("Fix mobile scrolling");
    expect(prompt).toContain("Do not do the task or use tools"); expect(prompt).toContain('{"title":null}');
  });
});
