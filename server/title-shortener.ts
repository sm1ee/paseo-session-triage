import type { PaseoApi } from "@getpaseo/client";
import type { PluginHookAgent } from "@getpaseo/plugin/server";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { cheapestThinking, needsShortTitle, readShortTitle } from "../shared/short-titles";
import { triagePreferences } from "../shared/triage";
import type { TitleBudget } from "./title-budget";
import { TITLE_PROVIDERS, type GenerateTitle } from "./title-generator";

type Preferences = ReturnType<typeof triagePreferences.schema.parse>;
type Result = { changed: boolean; message: string };
export type ApplyShortTitle = (api: PaseoApi, id: string, expected: string, title: string, valid: () => boolean) => Promise<boolean>;

export async function titleModels(api: PaseoApi) {
  const snapshot = await api.providers.snapshot();
  return { models: snapshot.entries.filter(entry => entry.enabled && entry.status === "ready" &&
    (TITLE_PROVIDERS as readonly string[]).includes(entry.provider)).flatMap(entry =>
    (entry.models ?? []).filter(model => model.isSelectable !== false).map(model => ({
      provider: entry.provider, id: model.id, label: `${entry.label || entry.provider} · ${model.label}`,
      thinkingOptions: (model.thinkingOptions ?? []).map(option => ({ id: option.id, label: option.label })),
    }))).slice(0, 2000) };
}

export class TitleShortener {
  private stopped = false;
  private generation = 0;
  private busy = false;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private queue = new Map<string, { api: PaseoApi; agent: PluginHookAgent }>();
  private preferences?: Promise<Preferences>;
  private lastAutomatic = Number.NEGATIVE_INFINITY;
  private enabled?: boolean;
  private activeId?: string;
  private drained: Promise<void> = Promise.resolve();
  private lastError: string | null = null;
  constructor(private readonly settings: PluginSettings<typeof triagePreferences.schema>,
    private readonly budget: TitleBudget, private readonly generate: GenerateTitle,
    private readonly apply: ApplyShortTitle, private readonly now = Date.now,
    private readonly supported: () => Promise<boolean> = async () => true) {}

  settingsChanged(): void {
    this.generation++; this.preferences = undefined; this.enabled = undefined; this.queue.clear();
    clearTimeout(this.timer); this.timer = undefined; this.controller?.abort();
  }
  stop(): Promise<void> { this.stopped = true; this.settingsChanged(); return this.drained; }
  forget(id: string): void { this.queue.delete(id); if (this.activeId === id) this.controller?.abort(); }
  status(): string | null { return this.lastError; }

  onTurnEnd(api: PaseoApi, agent: PluginHookAgent): void {
    if (this.stopped || this.enabled === false || agent.parentAgentId || !agent.workspaceId || !needsShortTitle(agent.title || "")) return;
    // Metadata from the event is enough to queue candidates. No listing,
    // conversation read, or model discovery happens in a lifecycle handler.
    if (this.queue.size >= 10 && !this.queue.has(agent.id)) return;
    this.queue.set(agent.id, { api, agent }); this.schedule();
  }
  private schedule(): void {
    if (this.stopped || this.busy || this.timer || !this.queue.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.next(); }, Math.max(2000, this.lastAutomatic + 60_000 - this.now()));
  }
  private async next(): Promise<void> {
    const work = this.queue.values().next().value;
    if (!work || this.stopped) return;
    const generation = this.generation;
    this.queue.delete(work.agent.id);
    try {
      if (!(await this.config()).shortenTitles) { this.queue.clear(); return; }
      if (this.stopped || generation !== this.generation) return;
      this.lastAutomatic = this.now();
      await this.shorten(work.api, work.agent.id); this.lastError = null;
    } catch { this.lastError = "Could not shorten a title. Check the selected model in Settings."; }
    finally { this.schedule(); }
  }
  private config(): Promise<Preferences> {
    const generation = this.generation;
    return this.preferences ??= this.settings.read().then(state => {
      if (state.status !== "ready") throw new Error("Title settings are unavailable.");
      const values = triagePreferences.schema.parse(state.values);
      if (generation === this.generation) this.enabled = values.shortenTitles;
      return values;
    });
  }
  async shorten(api: PaseoApi, id: string): Promise<Result> {
    if (this.stopped) throw new Error("Title shortening has stopped.");
    if (this.busy) throw new Error("Another title is being shortened.");
    this.busy = true;
    let finish!: () => void;
    this.drained = new Promise(resolve => { finish = resolve; });
    const generation = this.generation, abort = new AbortController(); this.controller = abort; this.activeId = id;
    const valid = () => !this.stopped && !abort.signal.aborted && generation === this.generation;
    const timeout = setTimeout(() => abort.abort(), 45_000);
    try {
      const settings = await this.config();
      if (!settings.shortenTitles) throw new Error("Turn on Shorten long titles in Settings first.");
      if (!settings.titleProvider || !settings.titleModel) throw new Error("Choose a title model in Settings first.");
      if (!valid()) return { changed: false, message: "Title shortening cancelled." };
      const agent = (await api.agents.ref(id).refresh())?.agent;
      if (!valid()) return { changed: false, message: "Title shortening cancelled." };
      if (!agent || agent.archivedAt || !agent.workspaceId || agent.labels["paseo.parent-agent-id"] ||
          agent.labels["session-triage.title-helper"] === "1" || "internal" in agent && agent.internal) throw new Error("Choose an available top-level session.");
      if (agent.activeTurn || agent.pendingPermissions.length || ["initializing", "error"].includes(agent.status))
        return { changed: false, message: "Try again when this session is idle." };
      const original = agent.title || "";
      if (!needsShortTitle(original)) return { changed: false, message: "This title is already short." };
      if (!await this.supported()) throw new Error("Title shortening requires Paseo 0.12 or later with background workspaces.");
      const { models } = await titleModels(api);
      const model = models.find(model => model.provider === settings.titleProvider && model.id === settings.titleModel);
      if (!model) throw new Error("The selected title model is unavailable. Choose another model in Settings.");
      const thinking = settings.titleThinking || cheapestThinking(model.thinkingOptions);
      if (thinking && !model.thinkingOptions.some(option => option.id === thinking)) throw new Error("Choose a supported reasoning level in Settings.");
      if (!valid()) return { changed: false, message: "Title shortening cancelled." };
      if (!await this.budget.claim(id, settings.titleDailyLimit)) return { changed: false, message: "Already attempted for this session, or the daily limit was reached." };
      if (!valid()) return { changed: false, message: "Title shortening cancelled." };
      // Once reserved, failures and ambiguous deliveries remain spent. Never
      // retry automatically or switch to a different/billable model.
      const response = await this.generate({ title: original, provider: model.provider, model: model.id, thinking, signal: abort.signal });
      const title = readShortTitle(response, original);
      if (!title) return { changed: false, message: "No valid shorter title was returned. The original title was kept." };
      if (!valid()) return { changed: false, message: "Title shortening cancelled." };
      const changed = await this.apply(api, id, original, title, valid);
      return { changed, message: changed ? "Title shortened." : "The session changed. Its title was kept." };
    } finally {
      clearTimeout(timeout); if (this.controller === abort) this.controller = undefined;
      this.busy = false; this.activeId = undefined; finish(); this.schedule();
    }
  }
}
