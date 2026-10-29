import { z } from "zod";
import { createHash } from "node:crypto";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

export interface ActiveTitleGoal { objective: string; revision: string }
export type ReadTitleGoal = (id: string) => Promise<ActiveTitleGoal | null>;
const control = z.object({
  id: z.string(), visible: z.boolean(), state: z.string().nullable(), key: z.string().nullable(),
  objective: z.string().max(16_000).nullable().optional(),
  source: z.enum(["codex", "claude", "opencode", "omp", "timeline"]).nullable().optional(),
  nativeAction: z.enum(["pause", "resume"]).nullable().optional(),
  nativeReconnect: z.boolean().optional(), nativeStart: z.boolean().optional(),
  holdReason: z.string().nullable().optional(),
});

export function activeTitleGoal(input: unknown, id: string): ActiveTitleGoal | null {
  const parsed = control.safeParse(input); if (!parsed.success) return null;
  const goal = parsed.data;
  if (goal.id !== id || !goal.visible || goal.state !== "active" || !goal.key || !goal.objective?.trim() ||
      !goal.source || goal.source === "timeline" || goal.nativeAction !== "pause" || goal.nativeReconnect || goal.nativeStart ||
      goal.holdReason && !["goal_disabled", "goal_unselected", "excluded"].includes(goal.holdReason)) return null;
  const objective = Array.from(goal.objective.trim()).slice(0, 600).join("");
  return { objective, revision: createHash("sha256").update(JSON.stringify([goal.key, goal.objective, goal.source])).digest("hex") };
}

export function titleGoalReader(connect: () => Promise<DaemonClient>): ReadTitleGoal {
  return async id => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Read-only preview from the existing provider adapters. Never request a
      // timeline restoration, send commands, or change recovery selection.
      const client = await connect();
      const request = client.invokePluginRpc("session-recovery", "recovery.goal.control",
        { id, fresh: true, inspect: false, preview: true });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Goal preview timed out")), 3500); });
      return activeTitleGoal(await Promise.race([request, timeout]), id);
    } catch { return null; } // Optional integration: use recent work if unavailable.
    finally { clearTimeout(timer); }
  };
}
