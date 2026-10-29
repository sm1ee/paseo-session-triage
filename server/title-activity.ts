import type { PaseoAgent } from "@getpaseo/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface TitleActivity {
  has(id: string, revision: string): Promise<boolean>;
  mark(id: string, revision: string): Promise<void>;
}

// Title/icon/label writes change updatedAt but are not new conversation activity.
export function titleActivityRevision(agent: PaseoAgent): string {
  return createHash("sha256").update(JSON.stringify([agent.lastUserMessageAt ?? null, agent.lastUsage ?? null])).digest("hex");
}

export class FileTitleActivity implements TitleActivity {
  constructor(private readonly directory: string) {}
  private path(id: string): string { return join(this.directory, createHash("sha256").update(id).digest("hex")); }
  async has(id: string, revision: string): Promise<boolean> {
    try { return (await readFile(this.path(id), "utf8")) === revision; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  async mark(id: string, revision: string): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(id), temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, revision, { mode: 0o600, flag: "wx" }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
}
