import type { PluginServerContext } from "@getpaseo/plugin/server";
import { TriageService } from "./server/triage-service";
import { triagePreferences, triageSnapshotRpc, triageInspectRpc } from "./shared/triage";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(triagePreferences);
  const service = new TriageService(settings);
  server.handle(triageSnapshotRpc, ({ refresh }, { paseo }) => service.snapshot(paseo, refresh));

  server.handle(triageInspectRpc, ({ id }, { paseo }) => service.inspect(paseo, id));

  const removeHooks = [
    server.on("agent.created", (event) => service.invalidate(event.agent.id)),
    server.on("agent.turn_started", (event) => service.invalidate(event.agent.id)),
    server.on("agent.turn_ended", (event) => service.invalidate(event.agent.id)),
    server.on("agent.permission_requested", (event) => service.invalidate(event.agent.id)),
    server.on("agent.permission_resolved", (event) => service.invalidate(event.agent.id)),
    server.on("agent.closed", (event) => service.invalidate(event.agent.id)),
    server.on("agent.archived", (event) => service.invalidate(event.agent.id)),
  ];
  const removeSettings = settings.subscribe(() => service.invalidate());

  return () => {
    for (const remove of removeHooks) remove();
    removeSettings();
    service.stop();
  };
}
