import type { PluginServerContext } from "@getpaseo/plugin/server";
import { TriageService } from "./server/triage-service";
import { TitleWriter } from "./server/title-writer";
import { triagePreferences, triageSnapshotRpc, triageInspectRpc } from "./shared/triage";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(triagePreferences);
  const writer = new TitleWriter();
  const service = new TriageService(settings, Date.now, (id, title) => writer.rename(id, title));
  server.handle(triageSnapshotRpc, ({ refresh }, { paseo }) => service.snapshot(paseo, refresh));

  server.handle(triageInspectRpc, ({ id }, { paseo }) => service.inspect(paseo, id));

  const removeHooks = [
    server.on("agent.created", (event, { paseo }) => service.activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.turn_started", (event, { paseo }) => service.activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.turn_ended", (event, { paseo }) => service.activity(paseo, event.agent.id, event.timeline, event.agent.parentAgentId)),
    server.on("agent.permission_requested", (event, { paseo }) => service.activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.permission_resolved", (event, { paseo }) => service.activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.closed", (event, { paseo }) => service.activity(paseo, event.agent.id, undefined, event.agent.parentAgentId)),
    server.on("agent.archived", (event) => service.archived(event.agent.id)),
  ];
  const removeSettings = settings.subscribe(() => service.settingsChanged());

  return async () => {
    for (const remove of removeHooks) remove();
    removeSettings();
    service.stop();
    await writer.close();
  };
}
