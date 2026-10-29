import type { PaseoAgent } from "@getpaseo/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TRIAGE_DISPLAY, type TriageRow } from "../shared/triage";

const recordSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(["needs-action", "ready-to-send", "needs-you", "checking", "done"]),
  source: z.enum(["recent-message", "fallback"]),
});
export type TriageEvidence = z.infer<typeof recordSchema>;
export interface TriageEvidenceStore {
  read(id: string): Promise<TriageEvidence | null>;
  write(id: string, evidence: TriageEvidence): Promise<void>;
}

// Presentation edits and idle/closed runtime transitions are not new work.
export function triageRevision(agent: PaseoAgent): string {
  return createHash("sha256").update(JSON.stringify([agent.lastUserMessageAt ?? null, agent.lastUsage ?? null,
    agent.attentionTimestamp ?? null, agent.activeTurn?.turnId ?? null, agent.pendingPermissions.map(p => p.id),
    agent.lastError ?? null, ["error", "initializing"].includes(agent.status) ? agent.status : "settled"])).digest("hex");
}

export function restoreEvidence(agent: PaseoAgent, evidence: TriageEvidence): TriageRow {
  return { id: agent.id, title: agent.title || agent.id, cwd: agent.cwd, provider: agent.provider, updatedAt: agent.updatedAt,
    state: evidence.state, source: evidence.source,
    summary: evidence.source === "fallback" ? "The latest reply could not be classified. Check the session." : TRIAGE_DISPLAY[evidence.state].description,
    action: evidence.state === "done" ? "" : "Open the session for context." };
}

// Persist only a metadata hash and classification enums, never reply excerpts.
export class FileTriageEvidence implements TriageEvidenceStore {
  constructor(private readonly directory: string) {}
  private path(id: string): string { return join(this.directory, createHash("sha256").update(id).digest("hex")); }
  async read(id: string): Promise<TriageEvidence | null> {
    try { const value = recordSchema.safeParse(JSON.parse(await readFile(this.path(id), "utf8"))); return value.success ? value.data : null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
  }
  async write(id: string, evidence: TriageEvidence): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(id), temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(recordSchema.parse(evidence)), { mode: 0o600, flag: "wx" }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
}
