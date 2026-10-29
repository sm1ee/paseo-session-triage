import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { triagePreferences } from "../shared/triage";
import { cheapestThinking, shortTitleModelsRpc } from "../shared/short-titles";
import type { z } from "zod";
import { TitleModelPicker } from "./model-picker";

export function TriageSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(triagePreferences);
  const fetchModels = useRpc(shortTitleModelsRpc);
  const [models, setModels] = useState<z.infer<typeof shortTitleModelsRpc.output>["models"]>([]);
  const [modelError, setModelError] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [supported, setSupported] = useState(false);
  async function loadModels() {
    setLoadingModels(true); setModelError(false); setSupported(false);
    try { const result = await fetchModels({}); setModels(result.models); setSupported(result.supported); }
    catch { setModelError(true); }
    finally { setLoadingModels(false); }
  }
  useEffect(() => { void loadModels(); }, [fetchModels]);
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foreground }}>{settings.status === "loading" ? "Loading settings…" : "Could not load settings."}</Text>;
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
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
      <SettingsSection title="Short titles">
        <SettingsCard>
          <SettingsSwitch
            label="Shorten titles"
            hint="Once per session after a completed turn. Uses only the title, never the conversation."
            value={settings.values.shortenTitles}
            disabled={!supported && !settings.values.shortenTitles}
            onValueChange={(value) => void settings.save({ ...settings.values, shortenTitles: value }, settings.revision)}
          />
          <SettingsSwitch
            label="Long titles only"
            hint="Only titles over 40 characters. Turn off to include shorter titles."
            value={settings.values.titleLongOnly}
            onValueChange={(value) => void settings.save({ ...settings.values, titleLongOnly: value }, settings.revision)}
          />
          <TitleModelPicker theme={theme} models={models} provider={settings.values.titleProvider} modelId={settings.values.titleModel}
            disabled={loadingModels} onSelect={(selected) => void settings.save({ ...settings.values,
              titleProvider: selected.provider, titleModel: selected.id, titleThinking: cheapestThinking(selected.thinkingOptions) }, settings.revision)} />
          {(() => {
            const selected = models.find(model => model.provider === settings.values.titleProvider && model.id === settings.values.titleModel);
            const options = selected?.thinkingOptions ?? [];
            return options.length ? <SettingsSelect label="Reasoning" value={settings.values.titleThinking || cheapestThinking(options)}
              options={options.map(option => ({ label: option.label, value: option.id }))}
              onValueChange={(value) => void settings.save({ ...settings.values, titleThinking: value }, settings.revision)} /> : null;
          })()}
          <SettingsSelect label="Daily request limit" hint="Includes failed attempts. Defaults to 5; no automatic retries."
            value={String(settings.values.titleDailyLimit)} options={[1, 5, 10, 25, 50].map(value => ({ label: String(value), value: String(value) }))}
            onValueChange={(value) => void settings.save({ ...settings.values, titleDailyLimit: Number(value) }, settings.revision)} />
          {modelError || !loadingModels && !models.length ? <SettingsAction label={modelError ? "Could not load models" : "No supported models available"}
            hint="Enable Claude, Codex, OpenCode, or OMP in Paseo, then reload the list."
            actionLabel="Reload models" disabled={loadingModels} onPress={() => void loadModels()} /> : null}
        </SettingsCard>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          Only shorter results are saved. Titles of four characters or fewer are skipped. Existing sessions are handled after their next completed turn, or with Shorten session title in the Command Center.
        </Text>
        {!loadingModels && !supported ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Requires Paseo 0.12 or later with background workspaces.</Text> : null}
      </SettingsSection>
      {settings.saveError ? <Text style={{ color: theme.colors.foreground }}>{settings.saveError}</Text> : null}
    </ScrollView>
  );
}
