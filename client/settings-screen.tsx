import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { triagePreferences } from "../shared/triage";

export function TriageSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(triagePreferences);
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foreground }}>{settings.status === "loading" ? "Loading settings…" : "Could not load settings."}</Text>;
  }

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title="Sessions">
        <SettingsCard>
          <SettingsSwitch
            label="Update title icons"
            hint="Update session and workspace icons when their status changes."
            value={settings.values.renameTitles}
            onValueChange={(value) => void settings.save({ ...settings.values, renameTitles: value }, settings.revision)}
          />
          <SettingsSelect
            label="Maximum sessions"
            value={String(settings.values.maxSessions)}
            options={[20, 40, 60, 100].map((value) => ({ label: String(value), value: String(value) }))}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, maxSessions: Number(value) }, settings.revision)
            }
          />
          <SettingsSwitch
            label="Include subagents"
            hint="Off by default."
            value={settings.values.includeSubagents}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, includeSubagents: value }, settings.revision)
            }
          />
        </SettingsCard>
      </SettingsSection>
      {settings.saveError ? <Text style={{ color: theme.colors.foreground }}>{settings.saveError}</Text> : null}
    </View>
  );
}
