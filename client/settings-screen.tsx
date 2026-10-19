import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { triagePreferences } from "../shared/triage";

export function TriageSettingsScreen() {
  const settings = useSettings(triagePreferences);
  if (settings.status !== "ready") {
    return <Text>{settings.status === "loading" ? "Loading settings…" : "Could not load settings."}</Text>;
  }

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title="Sessions">
        <SettingsCard>
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
      <SettingsSection title="Names">
        <SettingsCard>
          <SettingsSwitch
            label="Add status emoji to session and workspace names"
            hint="Pinned items show workspace names. Turning this off does not restore names already changed."
            value={settings.values.renameTitles}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, renameTitles: value }, settings.revision)
            }
          />
        </SettingsCard>
      </SettingsSection>
      {settings.saveError ? <Text>{settings.saveError}</Text> : null}
    </View>
  );
}
