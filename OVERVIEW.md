# Session triage

See the Paseo sessions that need your attention in one place. Filter the list by status, open a session, or check the attention count in the desktop and web sidebar. The icon guide is available from the screen toolbar. The sidebar shortcut is hidden in the iOS and Android apps; open Session triage from the Command Center there.

The icons mean:

- 🔴 **Error:** Paseo reports an agent error.
- ❓ **Needs your input:** A permission request is pending, or the agent asks for a decision or reply.
- 📤 **Ready to send:** A draft appears ready for you to review and send.
- 🟠 **Needs review:** The work is unfinished, or the latest update is unclear.
- 👀 **Waiting on a result:** The agent appears to be waiting for CI, a build, a deployment, or a review.
- ⏳ **Working:** The agent is running a turn or starting up.
- ○ **Idle:** No active turn. Use Check reply to classify the latest response.
- ✅ **Done:** The latest reply says the work is done. Check the result yourself.

Session triage checks Paseo metadata in the background. Idle sessions stay unclassified until you choose Check reply, which reads up to 20 recent timeline items from that one idle session. Pending permissions and errors come from Paseo. Labels inferred from chat wording can be wrong; ✅ does not verify a build, test, deployment, or submission.

By default, it shows the 20 most recent top-level sessions. Settings let you include subagents and change the limit. The screen and sidebar check for updates while open, and you can refresh the list yourself.

The optional Update title icons setting updates session and workspace markers after lifecycle events. Existing title-update preferences are respected. Changes are queued one at a time, repeated events are merged, and unchanged titles are skipped. When a completed-turn event includes recent messages, the plugin uses those items. Paseo 0.13 sends no message content in this event; metadata updates the icon, and Check reply classifies the response when requested. No background conversation scan is added.

**Generate titles** is off by default. Open Settings in the dashboard toolbar, choose an enabled Paseo model, and select a title source. Existing title sends only the title (up to 320 Unicode characters), with an optional 40-character eligibility threshold. Recent conversation generates a concrete task name from at most the latest user message and subsequent assistant reply (600 Unicode characters each), reusing event content or fetching one page of up to 6 recent timeline items after reserving the request budget. It excludes reasoning, tool output, and code blocks. It can replace a short generic goal title with a longer task name, up to 40 characters. The selected title provider receives these excerpts only when Recent conversation is selected; existing installations keep the title-only source.

Automatic generation runs once per top-level session after a completed turn. Use Generate session title in the Command Center to explicitly regenerate an idle session's title. Automatic and manual attempts share a daily limit (5 by default), including failed or cancelled attempts. There are no automatic retries or fallback models. Automatic jobs run one at a time, at most once per minute. Enabling the feature does not scan session history. Choose a small model and the lowest reasoning setting to reduce cost; provider overhead can add tokens beyond the prompt.

Title generation requires Paseo 0.12 or later with background workspaces. It reuses one dedicated background workspace with an empty context directory and removes each helper session after its request. Only helper sessions created by this plugin are removed. It never sends title prompts to, approves permissions for, stops, deletes, archives, or resumes existing sessions or goals. Status icons, folder prefixes, and names edited while generation is running are preserved. A new turn cancels pending generation.

Excerpts stay in plugin memory and are not written to plugin files or logs. Settings are stored by Paseo; content-free attempt records survive reloads. Paseo's built-in workspace naming is separate, under Settings → Host → Metadata. Other triage features require stable Paseo 0.11.4 or later.
