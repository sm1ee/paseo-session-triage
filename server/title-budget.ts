import { createHash } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface TitleBudget {
  claim(id: string, dailyLimit: number): Promise<boolean>;
}

// A reservation survives reloads and failures. Neither the title nor chat text
// is stored. Exclusive slots cap attempts even across overlapping plugin reloads.
export class FileTitleBudget implements TitleBudget {
  constructor(private readonly directory: string, private readonly now = Date.now) {}
  async claim(id: string, dailyLimit: number): Promise<boolean> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const hash = createHash("sha256").update(id).digest("hex");
    const session = join(this.directory, `session-${hash}`);
    let handle;
    try { handle = await open(session, "wx", 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
    await handle.close();
    const day = new Date(this.now()).toISOString().slice(0, 10);
    // Never discard old attempts or free a slot after a timeout: the provider
    // may already have billed it. Limit changes don't reuse occupied slots.
    for (let slot = 0; slot < dailyLimit; slot++) {
      try {
        const reservation = await open(join(this.directory, `${day}-${slot}`), "wx", 0o600);
        await reservation.close(); return true;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    // No request was made. Allow this session to be considered on a later day.
    await unlink(session);
    return false;
  }
}
