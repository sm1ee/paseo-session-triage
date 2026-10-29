import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { TRIAGE_DISPLAY, TRIAGE_ORDER, TRIAGE_TITLE_PREFIX, triageSnapshotRpc, triageInspectRpc, type TriageRow, type TriageState } from "../shared/triage";

const QUERY_KEY = ["session-triage", "snapshot", 5] as const;

function TriageSessionRow({ row, theme, compact, onOpen, onInspect, inspecting, checking, last }: {
  row: TriageRow;
  theme: PluginScreenProps["theme"];
  compact: boolean;
  onOpen?: () => void;
  onInspect: () => void;
  inspecting: boolean;
  checking: boolean;
  last: boolean;
}) {
  const folder = row.cwd.split(/[\\/]/u).filter(Boolean).pop() || row.cwd;
  // The group and folder metadata already represent these title decorations.
  const title = row.title.replace(TRIAGE_TITLE_PREFIX, "").replace(/^〖[^〗]+〗\s*/u, "");
  const summary = row.state === "error" && /\bToo Many Requests\b/iu.test(row.summary)
    ? "Too many requests (429). Try again later." : row.summary;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: compact ? 8 : 16,
      paddingHorizontal: 14, paddingVertical: compact ? 12 : 11,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.colors.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${TRIAGE_DISPLAY[row.state].label}: ${row.title}`}
        accessibilityHint={row.action || "Open session"} disabled={!onOpen} onPress={onOpen}
        style={({ pressed }) => ({ flex: 1, minWidth: 0, gap: 3, opacity: pressed ? 0.65 : 1 })}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 19, fontWeight: "500" }} numberOfLines={compact ? 2 : 1}>
          {title}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }} numberOfLines={1}>
          {folder} · {row.provider}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }} numberOfLines={compact ? 2 : 1}>
          {summary}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Check recent reply: ${title}`} disabled={inspecting} onPress={onInspect}
        style={({ pressed }) => ({ minHeight: compact ? 44 : 32, justifyContent: "center", paddingHorizontal: 8, borderRadius: 6,
          backgroundColor: pressed ? theme.colors.surface2 : "transparent", opacity: inspecting && !checking ? 0.45 : 1 })}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "500" }}>{checking ? "Checking…" : "Check reply"}</Text>
      </Pressable>
    </View>
  );
}

export function TriageScreen({ theme, layout, navigation, onOpenSettings }: PluginScreenProps & { onOpenSettings: () => void }) {
  const fetchSnapshot = useRpc(triageSnapshotRpc);
  const inspect = useRpc(triageInspectRpc);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [filter, setFilter] = useState<TriageState | null>(null);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchSnapshot({ refresh: false }),
    refetchInterval: query => query.state.data?.checkingReplies ? 5000 : 120_000,
    staleTime: 30_000,
    retry: false,
  });

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const next = await fetchSnapshot({ refresh: true });
      queryClient.setQueryData(QUERY_KEY, next);
    } catch {
      setRefreshError("Could not refresh sessions. Try again.");
    } finally {
      setRefreshing(false);
    }
  }

  async function inspectReply(id: string) {
    if (inspecting) return;
    setInspecting(id); setRefreshError(null);
    try { queryClient.setQueryData(QUERY_KEY, await inspect({ id })); }
    catch { setRefreshError("Could not check this reply. Try again when idle."); }
    finally { setInspecting(null); }
  }
  const rows = query.data?.rows ?? [];
  const padding = layout.compact ? 14 : 20;
  const counts = new Map(TRIAGE_ORDER.map((state) => [state, rows.filter((row) => row.state === state).length]));
  const checked = query.data?.checkedAt ? new Date(query.data.checkedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
  const filters: Array<TriageState | null> = [null, ...TRIAGE_ORDER.filter((state) => counts.get(state) || state === filter)];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding, paddingBottom: 36 }}
    >
      <View style={{ width: "100%", maxWidth: 1040, alignSelf: "center", gap: 16 }}>
      <View style={{ flexDirection: layout.compact ? "column" : "row", justifyContent: "space-between", alignItems: layout.compact ? "stretch" : "center", gap: 10 }}>
        <View style={{ flex: layout.compact ? undefined : 1 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "600" }}>
            Session triage
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 4 }}>
            {query.data?.checkingReplies ? `${rows.length} sessions · Checking replies…` : checked ? `${rows.length} sessions · Checked ${checked}` : "Checking sessions…"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Session triage settings" onPress={onOpenSettings}
          style={({ pressed }) => ({ minHeight: layout.compact ? 44 : 32, justifyContent: "center", paddingHorizontal: 10,
            borderRadius: 6, backgroundColor: pressed ? theme.colors.surface2 : "transparent" })}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Settings</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Icon guide" accessibilityState={{ expanded: showGuide }} onPress={() => setShowGuide(!showGuide)}
          style={({ pressed }) => ({ minHeight: layout.compact ? 44 : 32, justifyContent: "center", paddingHorizontal: 10,
            borderRadius: 6, backgroundColor: showGuide || pressed ? theme.colors.surface2 : "transparent" })}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Icon guide</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh session status"
          disabled={refreshing}
          onPress={() => void refresh()}
          style={({ pressed }) => ({ paddingHorizontal: 10, minHeight: layout.compact ? 44 : 32, justifyContent: "center", borderRadius: 6,
            borderWidth: 1, borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1, opacity: refreshing ? 0.5 : 1 })}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
        </View>
      </View>

      {showGuide ? <View style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, gap: 6 }}>
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
      </View> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {filters.map((state) => {
          const selected = filter === state;
          return <Pressable key={state ?? "all"} accessibilityRole="button" accessibilityState={{ selected }}
            accessibilityLabel={state ? `Filter: ${TRIAGE_DISPLAY[state].label}` : "Show all sessions"} onPress={() => setFilter(state)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, minHeight: layout.compact ? 40 : 30,
              borderRadius: 6, borderWidth: 1, borderColor: selected ? theme.colors.border : "transparent",
              backgroundColor: selected || pressed ? theme.colors.surface2 : "transparent" })}>
            <Text style={{ color: selected ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 12, fontWeight: selected ? "600" : "400" }}>
              {state ? TRIAGE_DISPLAY[state].label : "All"}
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{state ? counts.get(state) : rows.length}</Text>
          </Pressable>;
        })}
      </View>

      {query.isPending ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Loading sessions…</Text> : null}
      {query.error ? <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
        {query.data ? "Could not update sessions. Showing the last check." : "Could not load sessions. Try Refresh."}
      </Text> : null}
      {refreshError ? <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{refreshError}</Text> : null}
      {query.data?.error ? <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Could not scan sessions: {query.data.error}</Text> : null}
      {query.data?.renameErrors.map((error) => (
        <Text key={error} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Could not rename: {error}
        </Text>
      ))}
      {query.data?.shortTitleError ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {query.data.shortTitleError}
      </Text> : null}

      {TRIAGE_ORDER.filter((state) => filter === null || filter === state).map((state) => {
        const section = rows.filter((row) => row.state === state);
        if (section.length === 0) return null;
        return (
          <View key={state} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 2 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{TRIAGE_DISPLAY[state].emoji}</Text>
              <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>{TRIAGE_DISPLAY[state].label}</Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{section.length}</Text>
            </View>
            <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, overflow: "hidden" }}>
            {section.map((row, index) => (
              <TriageSessionRow
                key={row.id}
                row={row}
                theme={theme}
                compact={layout.compact} last={index === section.length - 1} checking={inspecting === row.id}
                onInspect={() => void inspectReply(row.id)} inspecting={inspecting !== null}
                onOpen={navigation ? () => navigation.openAgent({ agentId: row.id }) : undefined}
              />
            ))}
            </View>
          </View>
        );
      })}
      {!query.isPending && !query.error && !rows.some((row) => filter === null || row.state === filter) ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{filter ? "No sessions in this state." : "No sessions to show."}</Text>
      ) : null}
      {query.data?.truncated ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        Showing the first {rows.length} sessions. Adjust the limit in Settings.
      </Text> : null}
      </View>
    </ScrollView>
  );
}

export function useTriageAttentionCount() {
  const fetchSnapshot = useRpc(triageSnapshotRpc);
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchSnapshot({ refresh: false }),
    refetchInterval: 120_000,
    staleTime: 30_000,
    retry: false,
  });
  return query.data?.rows.filter((row) =>
    row.state === "error" || row.state === "needs-action" || row.state === "ready-to-send" || row.state === "needs-you"
  ).length ?? 0;
}
