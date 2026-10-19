import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { TRIAGE_DISPLAY, TRIAGE_ORDER, TRIAGE_TITLE_PREFIX, triageSnapshotRpc, type TriageRow } from "../shared/triage";

const QUERY_KEY = ["session-triage", "snapshot", 3] as const;

function TriageCard({
  row,
  theme,
  compact,
  onOpen,
}: {
  row: TriageRow;
  theme: PluginScreenProps["theme"];
  compact: boolean;
  onOpen?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${TRIAGE_DISPLAY[row.state].label}: ${row.title}`}
      disabled={!onOpen}
      onPress={onOpen}
      style={{
        padding: compact ? 12 : 16,
        borderRadius: 12,
        backgroundColor: theme.colors.surface1,
        gap: 5,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: compact ? 15 : 16, fontWeight: "600" }}>
        {TRIAGE_DISPLAY[row.state].emoji} {row.title.replace(TRIAGE_TITLE_PREFIX, "")}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
        {row.cwd} · {row.provider}
      </Text>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }} numberOfLines={3}>
        {row.summary}
      </Text>
      {row.action ? (
        <Text style={{ color: theme.colors.accent, fontSize: 13 }} numberOfLines={2}>
          {row.action}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function TriageScreen({ theme, layout, navigation }: PluginScreenProps) {
  const fetchSnapshot = useRpc(triageSnapshotRpc);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchSnapshot({ refresh: false }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const next = await fetchSnapshot({ refresh: true });
      queryClient.setQueryData(QUERY_KEY, next);
    } catch (error) {
      setRefreshError(String(error));
    } finally {
      setRefreshing(false);
    }
  }

  const rows = query.data?.rows ?? [];
  const padding = layout.compact ? 14 : 22;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding, gap: 18, paddingBottom: 36 }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: layout.compact ? 21 : 25, fontWeight: "700" }}>
            Session triage
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 }}>
            {query.data?.checkedAt
              ? `Last checked ${new Date(query.data.checkedAt).toLocaleString("en-US")}`
              : "Checking sessions…"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh session status"
          disabled={refreshing}
          onPress={() => void refresh()}
          style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: theme.colors.accent }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontWeight: "600" }}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
      </View>

      <View style={{ padding: 14, borderRadius: 12, backgroundColor: theme.colors.surface1, gap: 7 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "700" }}>
          What the icons mean
        </Text>
        {TRIAGE_ORDER.map((state) => (
          <Text key={state} style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
            <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
              {TRIAGE_DISPLAY[state].emoji} {TRIAGE_DISPLAY[state].label}
            </Text>
            {` · ${TRIAGE_DISPLAY[state].description}`}
          </Text>
        ))}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
          Permission requests come from Paseo. Requests in chat are inferred from the wording. ✅ does not verify the result.
        </Text>
      </View>

      {query.isPending ? <Text style={{ color: theme.colors.foregroundMuted }}>Loading sessions…</Text> : null}
      {query.error ? <Text style={{ color: theme.colors.foreground }}>Could not load sessions: {String(query.error)}</Text> : null}
      {refreshError ? <Text style={{ color: theme.colors.foreground }}>Could not refresh: {refreshError}</Text> : null}
      {query.data?.error ? <Text style={{ color: theme.colors.foreground }}>Could not scan sessions: {query.data.error}</Text> : null}
      {query.data?.truncated ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Showing up to the session limit set in Settings.
        </Text>
      ) : null}
      {query.data?.renameErrors.map((error) => (
        <Text key={error} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Could not rename: {error}
        </Text>
      ))}

      {TRIAGE_ORDER.map((state) => {
        const section = rows.filter((row) => row.state === state);
        if (section.length === 0) return null;
        return (
          <View key={state} style={{ gap: 9 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "700" }}>
              {TRIAGE_DISPLAY[state].emoji} {TRIAGE_DISPLAY[state].label} · {section.length}
            </Text>
            {section.map((row) => (
              <TriageCard
                key={row.id}
                row={row}
                theme={theme}
                compact={layout.compact}
                onOpen={navigation ? () => navigation.openAgent({ agentId: row.id }) : undefined}
              />
            ))}
          </View>
        );
      })}
      {!query.isPending && !query.error && rows.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>No sessions to show.</Text>
      ) : null}
    </ScrollView>
  );
}

export function useTriageAttentionCount() {
  const fetchSnapshot = useRpc(triageSnapshotRpc);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchSnapshot({ refresh: false }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
  return query.data?.rows.filter((row) =>
    row.state === "error" || row.state === "needs-action" || row.state === "ready-to-send" || row.state === "needs-you"
  ).length ?? 0;
}
