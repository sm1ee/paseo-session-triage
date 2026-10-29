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
    shortenTitles: z.boolean().default(false),
    titleLongOnly: z.boolean().default(true),
    titleSource: z.enum(["title", "conversation"]).default("title"),
    titleUpdateEvery: z.number().int().min(1).max(100).default(5),
    titleIncludeIdle: z.boolean().default(false),
    titleProvider: z.string().max(100).default(""),
    titleModel: z.string().max(300).default(""),
    titleThinking: z.string().max(100).default(""),
    titleDailyLimit: z.number().int().min(1).max(50).default(5),
  }),
});

export const triageStateSchema = z.enum([
  "error",
  "needs-action",
  "ready-to-send",
  "needs-you",
  "checking",
  "working",
  "idle",
  "done",
]);

export type TriageState = z.infer<typeof triageStateSchema>;

export const TRIAGE_TITLE_PREFIX = /^[🔴❓🟠📤👀⏳✅○]\s*/u;

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
    shortTitleError: z.string().nullable().optional(),
  }),
});

export const triageInspectRpc = defineRpc({
  name: "triage.inspect", input: z.object({ id: z.string().min(1) }), output: triageSnapshotRpc.output,
});

export const TRIAGE_DISPLAY: Record<TriageState, { emoji: string; label: string; description: string }> = {
  error: {
    emoji: "🔴",
    label: "Error",
    description: "Paseo reports an agent error.",
  },
  "needs-action": {
    emoji: "❓",
    label: "Needs your input",
    description: "A permission request is pending, or the agent has asked you to decide or reply.",
  },
  "ready-to-send": {
    emoji: "📤",
    label: "Ready to send",
    description: "A draft appears ready. Review it before sending or posting.",
  },
  "needs-you": {
    emoji: "🟠",
    label: "Needs review",
    description: "The work is unfinished, or the latest update is unclear.",
  },
  checking: {
    emoji: "👀",
    label: "Waiting on a result",
    description: "The agent appears to be waiting for CI, a build, a deployment, or a review.",
  },
  working: {
    emoji: "⏳",
    label: "Working",
    description: "The agent is running a turn or starting up.",
  },
  idle: { emoji: "○", label: "Idle", description: "No active turn. Check a reply to classify it." },
  done: {
    emoji: "✅",
    label: "Done",
    description: "The latest reply says the work is done. Check the result yourself.",
  },
};

export const TRIAGE_ORDER: readonly TriageState[] = [
  "error",
  "needs-action",
  "ready-to-send",
  "needs-you",
  "checking",
  "working",
  "idle",
  "done",
];
