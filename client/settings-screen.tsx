import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { triagePreferences } from "../shared/triage";

export function TriageSettingsScreen() {
  const settings = useSettings(triagePreferences);
  if (settings.status !== "ready") {
    return <Text>{settings.status === "loading" ? "설정을 불러오는 중…" : "설정을 읽지 못했습니다."}</Text>;
  }

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title="세션 범위">
        <SettingsCard>
          <SettingsSelect
            label="최대 세션 수"
            value={String(settings.values.maxSessions)}
            options={[20, 40, 60, 100].map((value) => ({ label: String(value), value: String(value) }))}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, maxSessions: Number(value) }, settings.revision)
            }
          />
          <SettingsSwitch
            label="하위 에이전트 포함"
            hint="기본값은 최상위 세션만 표시합니다."
            value={settings.values.includeSubagents}
            onValueChange={(value) =>
              void settings.save({ ...settings.values, includeSubagents: value }, settings.revision)
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="이름">
        <SettingsCard>
          <SettingsSwitch
            label="상태 이모지로 세션 이름 갱신"
            hint="켜면 15분마다 변경된 세션 이름 앞에 상태를 표시합니다. 기존 제목은 보존합니다."
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
