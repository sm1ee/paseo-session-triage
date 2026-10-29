import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { triagePreferences } from "../shared/triage";
import { cheapestThinking, shortTitleModelsRpc } from "../shared/short-titles";
import type { z } from "zod";
import { TitleModelPicker } from "./model-picker";
import { TitleFrequency } from "./title-frequency";

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
      <SettingsSection title="Session titles">
        <SettingsCard>
          <SettingsSwitch
            label="Generate titles"
            hint="Update from the selected source. Regenerate manually from the Command Center."
            value={settings.values.shortenTitles}
            disabled={!supported && !settings.values.shortenTitles}
            onValueChange={(value) => void settings.save({ ...settings.values, shortenTitles: value }, settings.revision)}
          />
          <SettingsSelect label="Title source" value={settings.values.titleSource}
            options={[{ label: "Existing title", value: "title" }, { label: "Active goal or recent work", value: "conversation" }]}
            onValueChange={(value) => void settings.save({ ...settings.values, titleSource: value as "title" | "conversation" }, settings.revision)} />
          {settings.values.titleSource === "conversation" ? <TitleFrequency theme={theme} value={settings.values.titleUpdateEvery}
            onSave={value => void settings.save({ ...settings.values, titleUpdateEvery: value }, settings.revision)} /> : null}
          <SettingsSwitch label="Include idle sessions"
            hint="Generate once from existing activity. Skip until new conversation activity. Uses the same daily limit."
            value={settings.values.titleIncludeIdle}
            onValueChange={value => void settings.save({ ...settings.values, titleIncludeIdle: value }, settings.revision)} />
          {settings.values.titleSource === "title" ? <SettingsSwitch
            label="Long titles only"
            hint="Only titles over 40 characters. Turn off to include shorter titles."
            value={settings.values.titleLongOnly}
            onValueChange={(value) => void settings.save({ ...settings.values, titleLongOnly: value }, settings.revision)}
          /> : null}
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
          {settings.values.titleSource === "conversation"
            ? "Uses a verified running goal first (requires session-recovery), otherwise recent work. Sends up to 600 goal characters or 1,200 characters of recent messages. Daily limits apply. Turn counts restart after reloads or settings changes."
            : "Uses only the existing title. Only shorter results are saved; titles of four characters or fewer are skipped."}
        </Text>
        {!loadingModels && !supported ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Requires Paseo 0.12 or later with background workspaces.</Text> : null}
      </SettingsSection>
      {settings.saveError ? <Text style={{ color: theme.colors.foreground }}>{settings.saveError}</Text> : null}
    </ScrollView>
  );
}
