import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export const TITLE_CONTEXT_ITEMS = 6;
export const TITLE_CONTEXT_CHARS = 600;
export interface TitleContextMessage { role: "user" | "assistant"; text: string }

export function titleContext(items: readonly AgentTimelineItem[]): TitleContextMessage[] {
  const recent = items.slice(-TITLE_CONTEXT_ITEMS);
  let user = -1, assistant = -1;
  recent.forEach((item, index) => {
    if (item.type === "user_message" && item.text.trim()) user = index;
    if (item.type === "assistant_message" && item.text.trim()) assistant = index;
  });
  return [user, assistant > user ? assistant : -1].filter(index => index >= 0).flatMap(index => {
    const item = recent[index];
    if (item.type !== "user_message" && item.type !== "assistant_message") return [];
    const bounded = item.text.slice(0, TITLE_CONTEXT_CHARS * 2)
      .replace(/```[\s\S]*?(?:```|$)/gu, "[code omitted]").replace(/\s+/gu, " ").trim();
    const text = Array.from(bounded).slice(0, TITLE_CONTEXT_CHARS).join("");
    return text ? [{ role: item.type === "user_message" ? "user" as const : "assistant" as const, text }] : [];
  });
}
