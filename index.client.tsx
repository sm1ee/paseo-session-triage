import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
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
  const removeScreen = client.addScreen({ id: "triage", title: "세션 확인", Component: TriageScreen });
  const removeSidebar = client.addSidebarHeaderItem({
    id: "triage",
    title: "세션 확인",
    Component: TriageItem,
  });
  const removeSettings = client.addSettingsScreen({
    id: "triage-settings",
    title: "Session triage 설정",
    icon: "Settings",
    Component: TriageSettingsScreen,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-triage",
    title: "세션 확인 목록 열기",
    icon: "ListTodo",
    keywords: ["triage", "sessions", "확인", "세션"],
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
