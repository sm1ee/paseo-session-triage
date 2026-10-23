import { basename } from "node:path";
import type { PaseoWorkspace } from "@getpaseo/client";
import { TRIAGE_DISPLAY, TRIAGE_TITLE_PREFIX, type TriageRow } from "../shared/triage";

export function desiredTitle(row: TriageRow): string {
  const original = row.title.replace(TRIAGE_TITLE_PREFIX, "").trim();
  const folder = basename(row.cwd) || "workspace";
  const task = original.startsWith("〖") ? original : `〖${folder}〗${original}`;
  return `${TRIAGE_DISPLAY[row.state].emoji} ${task}`.slice(0, 120);
}
export function desiredWorkspaceTitle(row: TriageRow, workspace: Pick<PaseoWorkspace, "name" | "title">): string {
  const original = (workspace.title || workspace.name).replace(TRIAGE_TITLE_PREFIX, "").trim();
  return `${TRIAGE_DISPLAY[row.state].emoji} ${original || basename(row.cwd) || "workspace"}`.slice(0, 120);
}
