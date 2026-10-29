import type { PluginClientContext, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Alert, Platform, Text } from "react-native";
import { TriageScreen, useTriageAttentionCount } from "./client/triage-screen";
import { TriageSettingsScreen } from "./client/settings-screen";
import { shortenTitleRpc } from "./shared/short-titles";

function TriageItem({ currentScreen, openScreen, theme }: PluginSidebarItemProps) {
  const attention = useTriageAttentionCount();
  return (
    <SidebarRow
      icon="ListTodo"
      active={currentScreen?.screenId === "triage"}
      trailing={attention > 0 ? <Text style={{ color: theme.colors.foreground }}>{attention}</Text> : undefined}
      onPress={() => openScreen({ screenId: "triage" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  function Screen(props: PluginScreenProps) {
    return <TriageScreen {...props} onOpenSettings={() => client.openSettings("triage-settings")} />;
  }
  const removeScreen = client.addScreen({ id: "triage", title: "Session triage", Component: Screen });
  const removeSidebar = Platform.OS === "web" ? client.addSidebarHeaderItem({
    id: "triage",
    title: "Session triage",
    Component: TriageItem,
  }) : () => {};
  const removeSettings = client.addSettingsScreen({
    id: "triage-settings",
    title: "Session triage settings",
    icon: "Settings",
    Component: TriageSettingsScreen,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-triage",
    title: "Open session triage",
    icon: "ListTodo",
    keywords: ["triage", "sessions", "status"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "triage" });
    },
  });
  const removeShorten = client.addCommandCenterItem({
    id: "shorten-title", title: "Generate session title", icon: "TextCursorInput",
    keywords: ["title", "shorten", "rename"], context: "agent",
    async onSelect({ agent, rpc }) {
      try {
        const result = await rpc(shortenTitleRpc, { id: agent.id });
        Alert.alert("Session title", result.message);
      } catch {
        Alert.alert("Could not generate title", "Check Session titles in Session triage settings, then try again when the session is idle.");
      }
    },
  });
  return () => {
    removeShorten();
    removeCommand();
    removeSettings();
    removeSidebar();
    removeScreen();
  };
}
