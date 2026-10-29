import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const SHORT_TITLE_LENGTH = 40;
export const MAX_TITLE_INPUT = 320;
const decorations = /^([🔴❓🟠📤👀⏳✅○]\s*)?(〖[^〗]*〗\s*)?/u;

export function titleParts(title: string) {
  const prefix = title.match(decorations)?.[0] ?? "";
  return { prefix, body: title.slice(prefix.length).replace(/\s+/gu, " ").trim() };
}

export function needsShortTitle(title: string): boolean {
  return Array.from(titleParts(title).body).length > SHORT_TITLE_LENGTH;
}

export function cheapestThinking(options: readonly { id: string }[]): string {
  return ["none", "minimal", "low"].find(id => options.some(option => option.id === id)) ?? options[0]?.id ?? "";
}

export function readShortTitle(text: string, original: string): string | null {
  let title: unknown;
  try { title = JSON.parse(text.trim()).title; } catch { return null; }
  if (typeof title !== "string" || /[\r\n\p{Cc}\p{Cf}]/u.test(title)) return null;
  const body = title.trim();
  const size = Array.from(body).length;
  if (size < 4 || size > SHORT_TITLE_LENGTH || size >= Array.from(titleParts(original).body).length ||
      titleParts(body).prefix || /https?:\/\//iu.test(body)) return null;
  return body;
}

export const shortTitleModelsRpc = defineRpc({
  name: "triage.title-models", input: z.object({}),
  output: z.object({ supported: z.boolean().default(false), models: z.array(z.object({
    provider: z.string(), id: z.string(), label: z.string(),
    thinkingOptions: z.array(z.object({ id: z.string(), label: z.string() })),
  })) }),
});

export const shortenTitleRpc = defineRpc({
  name: "triage.shorten-title", input: z.object({ id: z.string().min(1).max(200) }),
  output: z.object({ changed: z.boolean(), message: z.string() }),
});
