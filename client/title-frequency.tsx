import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export function TitleFrequency({ value, onSave, theme }: {
  value: number; onSave(value: number): void; theme: PluginSurfaceProps["theme"];
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const valid = /^\d{1,3}$/u.test(draft) && Number(draft) >= 1 && Number(draft) <= 100;
  const changed = valid && Number(draft) !== value;
  const save = () => { if (changed) onSave(Number(draft)); };
  return <SettingsRow label="Update every" hint="Completed turns per session (1–100). Default: 5."
    error={!valid ? "Enter a whole number from 1 to 100." : null}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <TextInput accessibilityLabel="Completed turns between title updates" value={draft} onChangeText={setDraft}
        keyboardType="number-pad" inputMode="numeric" maxLength={3} onSubmitEditing={save}
        selectTextOnFocus style={{ color: theme.colors.foreground, borderWidth: 1, borderColor: theme.colors.border,
          borderRadius: 6, paddingHorizontal: 10, minHeight: 44, minWidth: 60, textAlign: "center" }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Save title update interval" disabled={!changed} onPress={save}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 6,
          backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1, opacity: changed ? 1 : 0.4 })}>
        <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Save</Text>
      </Pressable>
    </View>
  </SettingsRow>;
}
