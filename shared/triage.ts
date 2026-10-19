import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const triagePreferences = defineSettings({
  id: "triage",
  scope: "host",
  version: 1,
  schema: z.object({
    renameTitles: z.boolean().default(false),
    includeSubagents: z.boolean().default(false),
    maxSessions: z.number().int().min(10).max(100).default(20),
  }),
});

export const triageStateSchema = z.enum([
  "needs-you",
  "ready-to-send",
  "checking",
  "working",
  "done",
]);

export type TriageState = z.infer<typeof triageStateSchema>;

export const triageRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  cwd: z.string(),
  provider: z.string(),
  updatedAt: z.string(),
  state: triageStateSchema,
  summary: z.string(),
  action: z.string(),
  source: z.enum(["metadata", "recent-message", "fallback"]),
});

export type TriageRow = z.infer<typeof triageRowSchema>;

export const triageSnapshotRpc = defineRpc({
  name: "triage.snapshot",
  input: z.object({ refresh: z.boolean().default(false) }),
  output: z.object({
    rows: z.array(triageRowSchema),
    checkedAt: z.string().nullable(),
    truncated: z.boolean(),
    error: z.string().nullable(),
    renameErrors: z.array(z.string()),
  }),
});

export const TRIAGE_DISPLAY: Record<TriageState, { emoji: string; label: string }> = {
  "needs-you": { emoji: "🔴", label: "확인 필요" },
  "ready-to-send": { emoji: "📤", label: "보내기 대기" },
  checking: { emoji: "👀", label: "결과 확인 중" },
  working: { emoji: "⏳", label: "작업 중" },
  done: { emoji: "✅", label: "완료" },
};

export const TRIAGE_ORDER: readonly TriageState[] = [
  "needs-you",
  "ready-to-send",
  "checking",
  "working",
  "done",
];
