import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import type { TitleModel } from "../shared/short-titles";
import { filterTitleModels } from "../shared/short-titles";

export function TitleModelPicker({ theme, models, provider, modelId, disabled, onSelect }: {
  theme: PluginSurfaceProps["theme"];
  models: readonly TitleModel[];
  provider: string;
  modelId: string;
  disabled: boolean;
  onSelect(model: TitleModel): void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const selected = models.find(model => model.provider === provider && model.id === modelId);
  const providers = useMemo(() => [...new Set(models.map(model => model.provider))], [models]);
  const filtered = useMemo(() => filterTitleModels(models, search, filter), [models, search, filter]);
  const colors = theme.colors;
  const providerLabel = (id: string) => ({ claude: "Claude", codex: "Codex", opencode: "OpenCode", omp: "OMP" }[id] || id);

  return <>
    <SettingsAction label="Title model"
      hint={selected?.label || (modelId ? `${provider} · ${modelId} (unavailable)` : "Choose a configured model. Reasoning defaults to the lowest level.")}
      actionLabel={disabled ? "Loading…" : selected ? "Change" : "Choose"} disabled={disabled}
      onPress={() => { setSearch(""); setFilter(providers.includes(provider) ? provider : ""); setOpen(true); }} />
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }}>
        <Pressable accessibilityLabel="Close model picker" onPress={() => setOpen(false)}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
        <SafeAreaView style={{ flex: 1 }} pointerEvents="box-none">
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1, padding: 16, alignItems: "center", justifyContent: "center" }} pointerEvents="box-none">
            <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 620, flex: 1, maxHeight: 680,
              minHeight: 0, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0, overflow: "hidden" }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 8, paddingVertical: 4 }}>
                <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>Choose a model</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close model picker" onPress={() => setOpen(false)}
                  style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: colors.foregroundMuted, fontSize: 14 }}>Done</Text>
                </Pressable>
              </View>
              <TextInput accessibilityLabel="Search models" placeholder="Search models" placeholderTextColor={colors.foregroundMuted}
                value={search} onChangeText={setSearch} maxLength={120} autoCapitalize="none" autoCorrect={false}
                style={{ color: colors.foreground, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
                  borderRadius: 8, marginHorizontal: 12, minHeight: 44, paddingHorizontal: 12, fontSize: 14 }} />
              <View style={{ paddingVertical: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}>
                  {["", ...providers].map(id => <Pressable key={id || "all"} accessibilityRole="button" accessibilityState={{ selected: filter === id }}
                    onPress={() => setFilter(id)} style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: "center", borderRadius: 7,
                      backgroundColor: filter === id ? colors.surface2 : colors.surface0, borderColor: colors.border, borderWidth: 1 }}>
                    <Text style={{ color: filter === id ? colors.foreground : colors.foregroundMuted, fontSize: 12 }}>{id ? providerLabel(id) : "All"}</Text>
                  </Pressable>)}
                </ScrollView>
              </View>
              <FlatList data={filtered} style={{ flex: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
                keyExtractor={model => JSON.stringify([model.provider, model.id])}
                getItemLayout={(_, index) => ({ length: 64, offset: index * 64, index })}
                ListEmptyComponent={<Text style={{ color: colors.foregroundMuted, fontSize: 13, padding: 16 }}>No matching models.</Text>}
                renderItem={({ item }) => {
                  const active = item.provider === provider && item.id === modelId;
                  return <Pressable accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: active }}
                    onPress={() => { onSelect(item); setOpen(false); }}
                    style={({ pressed }) => ({ height: 64, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10,
                      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: active || pressed ? colors.surface2 : colors.surface0 })}>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: active ? "600" : "400" }}>{item.label}</Text>
                      <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>{item.id}</Text>
                    </View>
                    {active ? <Text style={{ color: colors.foreground }}>✓</Text> : null}
                  </Pressable>;
                }} />
              <Text style={{ color: colors.foregroundMuted, fontSize: 11, paddingHorizontal: 16, paddingVertical: 10 }}>{filtered.length} models</Text>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  </>;
}
