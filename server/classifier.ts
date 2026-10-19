import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { TriageRow, TriageState } from "../shared/triage";

export interface AgentForTriage {
  id: string;
  title: string | null;
  cwd: string;
  provider: string;
  updatedAt: string;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  activeTurn?: { turnId: string; startedAt: string | null } | null;
  pendingPermissions: readonly { title?: string; description?: string; kind: string }[];
  lastError?: string;
}

const SEND_DRAFT = /(?:초안|드래프트|draft|下書き|草稿)/iu;
const SEND_ACTION = /(?:보내|전송|발송|게시|제출|send|submit|publish|post|送信|投稿)/iu;
const SEND_READY = /(?:완성|작성|준비|검토|확인|대기|ready|prepared|review|approve|確認|完成|待ち)/iu;
const WAITING = /(?:대기|기다리|확인 중|진행 중|waiting|awaiting|monitoring|pending|確認中|待ち)/iu;
const EXTERNAL_CHECK = /(?:\bCI\b|빌드|테스트 결과|배포 결과|리뷰 결과|build|test result|deploy(?:ment)?|review result|パイプライン|ビルド)/iu;
const HUMAN_ACTION = /(?:승인|결정|확인 부탁|검토 부탁|답변 부탁|직접 .*필요|보내 주세요|제출해 주세요|needs? (?:your|human)|please (?:review|approve|decide)|your approval|manual step|判断|承認|確認してください)/iu;
const INCOMPLETE = /(?:미완|남아 있|필요합니다|불가|실패|보류|추가 검증|못했습니다|not (?:yet |fully )?(?:done|complete|verified)|incomplete|blocked|failed|pending action|未完|要確認)/iu;
const COMPLETED = /(?:완료했|완료됐|완료되었|수정했|구현했|통과했|끝났|completed|finished|implemented|fixed|passed|done\b|完了|修正済み)/iu;

function compact(value: string, limit = 180): string {
  const plain = value
    .replace(/```[\s\S]*?```/gu, "[코드]")
    .replace(/\[[^\]]+\]\([^)]*\)/gu, (link) => link.slice(1, link.indexOf("]")))
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
}

function recentAssistantText(timeline: readonly AgentTimelineItem[]): string {
  const recent = timeline.slice(-32);
  let lastUser = -1;
  for (let i = 0; i < recent.length; i++) {
    if (recent[i]?.type === "user_message") lastUser = i;
  }
  const parts: string[] = [];
  for (const item of recent.slice(lastUser + 1)) {
    if (item.type === "assistant_message" && item.text.trim()) {
      parts.push(item.text.slice(-1200));
    }
  }
  return parts.join(" ").slice(-2400);
}

export function classifyAgent(
  agent: AgentForTriage,
  timeline: readonly AgentTimelineItem[] = [],
  timelineError?: string,
): TriageRow {
  const title = agent.title?.trim() || agent.cwd.split(/[\\/]/u).filter(Boolean).at(-1) || agent.id;
  const base = {
    id: agent.id,
    title,
    cwd: agent.cwd,
    provider: agent.provider,
    updatedAt: agent.updatedAt,
  };

  function row(
    state: TriageState,
    summary: string,
    action: string,
    source: TriageRow["source"],
  ): TriageRow {
    return { ...base, state, summary, action, source };
  }

  const permission = agent.pendingPermissions[0];
  if (permission) {
    return row(
      "needs-you",
      compact(permission.title || permission.description || "권한 또는 답변을 기다립니다."),
      "Paseo에서 요청을 확인하고 답해주세요.",
      "metadata",
    );
  }
  if (agent.status === "error") {
    return row("needs-you", compact(agent.lastError || "에이전트 오류"), "오류를 확인해주세요.", "metadata");
  }
  if (agent.activeTurn || agent.status === "initializing") {
    return row("working", "에이전트가 현재 턴을 실행 중입니다.", "", "metadata");
  }
  if (timelineError) {
    return row("needs-you", "최근 대화를 읽지 못했습니다.", "세션을 직접 확인해주세요.", "fallback");
  }

  const message = recentAssistantText(timeline);
  if (!message) {
    if (agent.lastError) {
      return row("needs-you", compact(agent.lastError), "오류를 확인해주세요.", "metadata");
    }
    return row("needs-you", "최근 완료 응답이 없습니다.", "세션을 확인해주세요.", "fallback");
  }
  const summary = compact(message);
  if (SEND_DRAFT.test(message) && SEND_ACTION.test(message) && SEND_READY.test(message)) {
    return row("ready-to-send", summary, "초안을 검토하고 직접 전송하거나 게시해주세요.", "recent-message");
  }
  if (HUMAN_ACTION.test(message)) {
    return row("needs-you", summary, "요청된 판단이나 확인을 해주세요.", "recent-message");
  }
  if (WAITING.test(message) && EXTERNAL_CHECK.test(message)) {
    return row("checking", summary, "외부 작업의 결과를 기다리는 중입니다.", "recent-message");
  }
  if (INCOMPLETE.test(message)) {
    return row("needs-you", summary, "남은 작업이나 차단 원인을 확인해주세요.", "recent-message");
  }
  if (COMPLETED.test(message)) {
    return row("done", summary, "", "recent-message");
  }
  return row("needs-you", summary, "상태가 명확하지 않아 직접 확인이 필요합니다.", "fallback");
}
