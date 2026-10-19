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
  "error",
  "needs-you",
  "ready-to-send",
  "checking",
  "working",
  "done",
]);

export type TriageState = z.infer<typeof triageStateSchema>;

export const TRIAGE_TITLE_PREFIX = /^[🔴🟠📤👀⏳✅]\s*/u;

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

export const TRIAGE_DISPLAY: Record<TriageState, { emoji: string; label: string; description: string }> = {
  error: {
    emoji: "🔴",
    label: "오류",
    description: "Paseo가 에이전트 오류 상태 또는 마지막 오류를 보고했습니다. 오류 내용을 확인하세요.",
  },
  "needs-you": {
    emoji: "🟠",
    label: "확인 필요",
    description: "권한 요청·미완료·판단 요청이 있거나 상태가 불명확합니다. 세션을 확인하세요.",
  },
  "ready-to-send": {
    emoji: "📤",
    label: "보내기 대기",
    description: "보내거나 게시할 초안이 준비된 것으로 보입니다. 검토 후 직접 전송하세요.",
  },
  checking: {
    emoji: "👀",
    label: "결과 확인 중",
    description: "CI·빌드·테스트·배포·리뷰 같은 외부 결과를 기다리는 것으로 보입니다.",
  },
  working: {
    emoji: "⏳",
    label: "작업 중",
    description: "에이전트가 현재 턴을 실행 중이거나 초기화 중입니다.",
  },
  done: {
    emoji: "✅",
    label: "완료",
    description: "최근 응답에 완료 표현이 있습니다. 실제 결과는 직접 확인하세요.",
  },
};

export const TRIAGE_ORDER: readonly TriageState[] = [
  "error",
  "needs-you",
  "ready-to-send",
  "checking",
  "working",
  "done",
];
