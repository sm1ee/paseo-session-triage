import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Platform, Text } from "react-native";
import { TriageScreen, useTriageAttentionCount } from "./client/triage-screen";
import { TriageSettingsScreen } from "./client/settings-screen";

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
  const removeScreen = client.addScreen({ id: "triage", title: "Session triage", Component: TriageScreen });
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
  return () => {
    removeCommand();
    removeSettings();
    removeSidebar();
    removeScreen();
  };
}
