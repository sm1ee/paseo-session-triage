# Session triage for Paseo

See which Paseo sessions need your input, have a draft ready, are waiting on a result, or are done. Open a row to jump to that session. The sidebar shows how many sessions need attention. Filter the list by status, and open Icon guide when you need the emoji meanings.

Credit to [chaenmasahiro0425](https://github.com/chaenmasahiro0425) for [claude-session-triage](https://github.com/chaenmasahiro0425/claude-session-triage), the Claude Desktop skill that gave me the idea to mark sessions with emoji. This plugin is a separate implementation for Paseo. The original project is [MIT licensed](https://github.com/chaenmasahiro0425/claude-session-triage/blob/main/LICENSE).

![Session triage with private session details redacted](assets/session-triage-redacted.png)

Session titles, paths, and message text are redacted in this screenshot.

## Status icons

| Icon | Status | Meaning |
| --- | --- | --- |
| 🔴 | Error | Paseo reports an agent error. |
| ❓ | Needs your input | A permission request is pending, or the agent asks you to decide or reply. |
| 📤 | Ready to send | A draft appears ready. Review it before sending or posting. |
| 🟠 | Needs review | The work is unfinished, or the latest update is unclear. |
| 👀 | Waiting on a result | The agent appears to be waiting for CI, a build, a deployment, or a review. |
| ⏳ | Working | The agent is running a turn or starting up. |
| ○ | Idle | No active turn. Use Check reply to classify the latest response. |
| ✅ | Done | The latest reply says the work is done. Check the result yourself. |

Pending permission requests come from Paseo. Requests found in chat are inferred from the wording. A ✅ label does not verify that a build, test, deployment, or submission succeeded.

## Install

Requires stable Paseo 0.11.4 or later. Install the tagged GitHub version:

```sh
paseo plugin add git:sm1ee/paseo-session-triage --ref v0.4.1
paseo plugin ls session-triage
```

Open **Session triage** in the sidebar, then use **Settings** in its top-right toolbar to configure title shortening, title icons, and session limits. The same settings are also available under **Settings → Plugins → Session triage settings**.

## Session titles

Open **Session triage → Settings → Session titles**, choose a **Title model**, select a **Title source**, and turn on **Generate titles**. Generation is off by default. Models come from your enabled Claude, Codex, OpenCode, and OMP providers in Paseo; no separate API key is needed. Generation requires Paseo 0.12 or later with background workspace support; other triage features still support 0.11.4.

- **Existing title** is the default source. It sends only the title, capped at 320 Unicode characters. **Long titles only** is enabled by default and considers titles over 40 characters, excluding status icons and folder prefixes. Turn it off to include titles of 5–40 characters. Only strictly shorter results are saved; titles of four characters or fewer are skipped without a model call.
- **Active goal or recent work** first checks for a verified running Goal through the optional **session-recovery** plugin. It uses at most 600 Unicode characters of the active objective, without reading recent messages. Paused, blocked, limited, completed, cleared, stopped, or disconnected goals are not prioritized. A read-only native control preview is used; there are no goal commands, resumptions, or recovery selections. If the integration is missing, slow, or cannot confirm a running goal, it names the concrete task from recent messages instead of shortening a generic title such as `/goal continue`. It reuses message content from the completed-turn event when available; otherwise, after reserving the request budget, it fetches one page of at most **6 recent timeline items** from the target session. Only the latest user message and subsequent assistant reply are considered, capped at **600 Unicode characters each**. Reasoning, tool-call output, and code blocks are excluded. The selected model receives these excerpts and the existing title. This source ignores title length and can replace a short title with a longer task name, up to 40 characters. Empty or unclear context keeps the existing title; there is no fallback to title-only generation.
- In **Active goal or recent work**, set **Update every** to any whole number from **1 to 100 completed turns** and press **Save**. The default is **5 turns**, counted separately for each top-level session. Only successful completed-turn events count; duplicate known turn IDs are ignored. No goal lookup, conversation fetch, or model request occurs before an interval is due. Failed attempts wait until a new full interval; the same completion is never retried. A manual generation restarts the interval. Counts stay in bounded memory and restart after plugin reloads, settings changes, or session archiving; history is not scanned to reconstruct them.
- **Existing title** keeps its once-per-session automatic attempt rule. **Generate session title** in an idle session’s Command Center explicitly requests a new title for either source. Changing sources does not remove existing daily request reservations.
- **Include idle sessions** is off by default. Turn it on to also name existing top-level sessions without waiting for more completed turns. After a 10-second startup/settings delay, the plugin checks one page of up to 50 session metadata entries every 15 minutes, advancing through older sessions. It queues at most 10 candidates and uses the same selected source, serial generator, and daily quota. Running turns, pending permissions, errors, archived sessions, subagents, and internal helpers are skipped. Unchanged conversation activity is skipped before any Goal lookup, message fetch, or model request. New messages or changed provider token-usage metadata make a session eligible again; renames and icon updates do not. A content-free activity hash survives reloads and settings changes. Periodic and manual attempts also update it, so an idle scan does not duplicate the same work. Failed or unclear attempts are recorded too and are not retried for unchanged activity; quota-blocked sessions remain eligible later. Manual generation can override this deduplication. With Existing title, the same length/shorter-result rules still apply.
- Automatic and manual attempts share the default daily cap of **5 requests**, adjustable from 1 to 50 and reset at midnight UTC. Failed or cancelled attempts remain spent. Periodic updates and explicit manual regeneration can repeat within the same daily quota; failed requests are never automatically retried for the same completion. This is a request cap, not a monetary budget. Provider instructions and runtime overhead can still add tokens; choose a small model if cost matters.
- The model picker has local search, Provider filters, and a virtualized scrolling list for mobile. Reasoning defaults to off/none where supported, then minimal, low, or the lowest remaining named level. Explicit reasoning choices are respected.
- The selected model is used without automatic fallback. Automatic jobs run one at a time, at most once per minute. Invalid results keep the original title. New turns cancel conversation-based generation. A verified unchanged running Goal can keep its title job across native turns without interrupting the session. Settings changes and archiving cancel pending work and discard late results.
- A dedicated background workspace with an empty context directory is reused for title requests. Each request creates one restricted internal helper session and removes it afterward. Internal helpers do not trigger completion or permission push notifications. The empty workspace remains for reuse. The plugin never sends title prompts to, resumes, pauses, or interrupts existing sessions or goals.
- Status icons and folder prefixes are preserved. Names edited during generation are kept. A workspace title matching the old session title is updated with it; independently named workspaces are preserved. Excerpts are not written to plugin files or logs, though the selected provider receives the chosen goal objective or excerpts in Active goal or recent work mode. Goal state is checked again before saving; a stopped or changed goal discards the result.

Paseo 0.13 already generates titles for new **workspaces** and lets you select its model under **Settings → Host → Metadata** ([Paseo documentation](https://paseo.sh/docs/metadata-generation)). That setting also covers branch, commit, and pull request metadata. This plugin's toggle controls only session-title generation; it does not disable Paseo's own metadata generation.

The sidebar shortcut is hidden in the iOS and Android apps. Use **Open session triage** in the Command Center to open it there.

![Session triage settings showing the title icon option](assets/session-triage-settings.png)

This screenshot is cropped from the actual settings screen. Host details are outside the crop.

For local development, clone this repository and run:

```sh
npm install --ignore-scripts
npm run typecheck
npm test
paseo plugin add /absolute/path/to/paseo-session-triage
```

If the CLI is not on your `PATH` on macOS, use `/Applications/Paseo.app/Contents/Resources/bin/paseo`. After changing local code, run `paseo plugin reload session-triage`.

The manifest declares only `>=0.11.4`, without a minor-version upper bound. Compatibility is checked with Paseo 0.11.4, 0.12.0, and 0.13.0. A future breaking API change may still need a plugin update. SDK and runtime dependencies remain pinned for reproducible builds.

## How it works

- The default view shows up to 20 recent top-level sessions. You can include subagents or raise the limit in Settings.
- The screen and sidebar check metadata every two minutes while open. Scans share an in-flight request, debounce events, and back off after failures.
- Automatic checks read metadata only. Idle sessions stay unclassified until you choose **Check reply**. That action reads up to 20 recent timeline items from one idle session. Results stay in memory while its metadata is unchanged.
- Chat-based labels are rules of thumb. Unclear replies and failed timeline reads show 🟠.
- **Update title icons** restores automatic session and workspace markers when enabled. It updates the affected session after a start, end, permission, or close event. Existing settings are respected. The initial bounded metadata scan also repairs old markers.
- Title updates run one at a time, at most once per 300 ms. Repeated events are merged, matching titles are skipped, and failures back off for one minute. One local authenticated connection handles agent names, without starting a CLI for each change.
- On Paseo 0.11 and 0.12, completed-turn events include recent messages. Triage uses up to 20 of those items without refetching a timeline. Paseo 0.13 sends an empty timeline, so the icon follows session metadata until you choose **Check reply**. Icon updates do not fetch conversation history. Opt-in task-title generation separately reads at most 6 recent items after reserving its request budget.
- The plugin does not send messages to, approve requests for, stop, delete, or archive your existing sessions. Optional title generation creates and removes only its own helper sessions in a dedicated background workspace. Active goal or recent work sends a bounded active goal objective or recent excerpts to the selected title model; Existing title mode sends no conversation content. Excerpts stay in plugin memory; settings use Paseo's host settings store, and content-free title-attempt and activity-hash records are stored under `$PASEO_HOME/plugin-data/session-triage/`.

## Paseo plugin catalog

The [publishing guide](https://paseo.sh/docs/plugins/publishing) explains how to submit this repository to the [Paseo plugin catalog](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml). A catalog listing for this visual plugin needs a screenshot of the actual interface with private details removed. Catalog approval gives it an `owner/slug` install name.
