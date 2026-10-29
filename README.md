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
paseo plugin add git:sm1ee/paseo-session-triage --ref v0.2.1
paseo plugin ls session-triage
```

Open **Session triage** in the sidebar. To change the session limit or include subagents, open **Settings → Plugins → Session triage settings**.

## Short titles

Open **Session triage settings → Short titles**, choose a **Title model**, and turn on **Shorten long titles**. It is off by default. Models come from your enabled Claude, Codex, OpenCode, and OMP providers in Paseo; no separate API key is needed. Title shortening requires Paseo 0.12 or later with background workspace support; other triage features still support 0.11.4. For models with reasoning settings, the lowest advertised level is selected first and can be changed.

The model picker has a searchable, scrolling list and Provider filters. It stays within the available screen space on mobile, including when the keyboard is open. Reasoning defaults to off/none when supported, then minimal, low, or the lowest remaining named level. A reasoning level you choose manually is respected.

- Only top-level session titles longer than 40 characters are considered, excluding the status icon and folder prefix. Existing sessions are considered after their next completed turn; enabling the feature does not scan or rename your session history.
- Use **Shorten session title** in the Command Center of an idle session to shorten an existing title now. The same toggle and request limits apply.
- A session gets at most one model attempt, including failed or cancelled attempts. Records survive plugin reloads. The default daily cap is **5 requests**, adjustable from 1 to 50; the day resets at midnight UTC. This is a request cap, not a monetary budget.
- Only the title is sent, capped at 320 Unicode characters. The plugin does not load conversation history or attach files. It asks the helper to return only a title. Provider instructions, tool definitions, and runtime overhead can still add tokens; a provider-backed agent costs more than a bare text-completion request. Pick a small model if cost matters.
- The selected model is used without automatic retries or fallback models. Automatic jobs run one at a time, at most once per minute. Invalid results keep the original title.
- A dedicated background workspace with an empty context directory is reused for title requests. Each request creates one helper session with restricted provider settings and removes that session afterward. The empty background workspace remains available for reuse. It does not send messages to, resume, pause, or interrupt your existing sessions or goals. Turning the feature off cancels the helper and discards late results.
- Status icons and folder prefixes are preserved. If you rename the session while its title is being generated, that new name is kept. A matching workspace title is shortened with it; independently named workspaces are left alone.

Paseo 0.13 already generates titles for new **workspaces** and lets you select its model under **Settings → Host → Metadata** ([Paseo documentation](https://paseo.sh/docs/metadata-generation)). That setting also covers branch, commit, and pull request metadata. This plugin's toggle controls only session-title shortening; it does not disable Paseo's own metadata generation.

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
- On Paseo 0.11 and 0.12, completed-turn events include recent messages. Triage uses up to 20 of those items without refetching a timeline. Paseo 0.13 sends an empty timeline, so the icon follows session metadata until you choose **Check reply**. The plugin does not add a background conversation fetch to replace the removed event data.
- The plugin does not send messages to, approve requests for, stop, delete, or archive your existing sessions. Optional title shortening creates and removes only its own helper sessions in a dedicated background workspace. It never sends conversation text to another model. Short reply excerpts stay in memory; settings use Paseo's host settings store, and content-free title-attempt records are stored under `$PASEO_HOME/plugin-data/session-triage/title-attempts`.

## Paseo plugin catalog

The [publishing guide](https://paseo.sh/docs/plugins/publishing) explains how to submit this repository to the [Paseo plugin catalog](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml). A catalog listing for this visual plugin needs a screenshot of the actual interface with private details removed. Catalog approval gives it an `owner/slug` install name.
