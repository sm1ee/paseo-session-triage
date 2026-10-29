import type { PluginServerContext } from "@getpaseo/plugin/server";
import { TriageService } from "./server/triage-service";
import { TitleWriter } from "./server/title-writer";
import { triagePreferences, triageSnapshotRpc, triageInspectRpc } from "./shared/triage";
import { shortTitleModelsRpc, shortenTitleRpc } from "./shared/short-titles";
import { TitleShortener, titleModels } from "./server/title-shortener";
import { DaemonTitleGenerator } from "./server/title-generator";
import { FileTitleBudget } from "./server/title-budget";
import { titleGoalReader } from "./server/title-goal";
import { homedir } from "node:os";
import { join } from "node:path";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(triagePreferences);
  const writer = new TitleWriter();
  const service = new TriageService(settings, Date.now, (id, title) => writer.rename(id, title));
  const generator = new DaemonTitleGenerator(() => writer.client());
  const budget = new FileTitleBudget(join(process.env.PASEO_HOME || join(homedir(), ".paseo"), "plugin-data", "session-triage", "title-attempts"));
  const shortener = new TitleShortener(settings, budget, input => generator.generate(input),
    (api, id, expected, title, valid) => service.shortenTitle(api, id, expected, title, valid), Date.now, () => generator.supported(), titleGoalReader(() => writer.client()));
  server.handle(shortTitleModelsRpc, async (_, { paseo }) => ({ ...await titleModels(paseo), supported: await generator.supported() }));
  server.handle(shortenTitleRpc, ({ id }, { paseo }) => shortener.shorten(paseo, id, [], true));
  server.handle(triageSnapshotRpc, async ({ refresh }, { paseo }) => {
    const snapshot = await service.snapshot(paseo, refresh);
    return { ...snapshot, shortTitleError: shortener.status() };
  });

  server.handle(triageInspectRpc, ({ id }, { paseo }) => service.inspect(paseo, id));
  const activity = (...args: Parameters<TriageService["activity"]>) => {
    if (!generator.owns(args[1])) service.activity(...args);
  };

  const removeHooks = [
    server.on("agent.created", (event, { paseo }) => activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.turn_started", (event, { paseo }) => {
      shortener.turnStarted(event.agent.id);
      activity(paseo, event.agent.id, undefined, event.agent.parentAgentId);
    }),
    server.on("agent.turn_ended", (event, { paseo }) => {
      if (generator.owns(event.agent.id)) return;
      activity(paseo, event.agent.id, event.timeline, event.agent.parentAgentId);
      if (event.outcome.kind === "completed") shortener.onTurnEnd(paseo, event.agent, event.timeline, event.turnId);
    }),
    server.on("agent.permission_requested", (event, { paseo }) => activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.permission_resolved", (event, { paseo }) => activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.closed", (event, { paseo }) => activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.archived", (event) => { service.archived(event.agent.id); shortener.forget(event.agent.id, true); }),
  ];
  const removeSettings = settings.subscribe(() => { service.settingsChanged(); shortener.settingsChanged(); });

  return async () => {
    for (const remove of removeHooks) remove();
    removeSettings();
    service.stop();
    await shortener.stop();
    await writer.close();
  };
}
