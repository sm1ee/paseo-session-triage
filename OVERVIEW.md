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

**Shorten long titles** is off by default. Choose a model from your enabled Claude, Codex, OpenCode, or OMP providers in Session triage settings. Titles over 40 characters are shortened after a completed turn, or through **Shorten session title** in the Command Center. It sends only the title (at most 320 characters), preserves status icons and folder prefixes, and keeps names edited while a request is running. Existing history is not scanned. Each session gets one attempt; the default daily cap is 5, including failures, with no automatic retry or model fallback. The cap resets at midnight UTC. Provider instructions and runtime overhead can still add tokens. Paseo's built-in workspace naming is controlled separately under Settings → Host → Metadata.

Title shortening requires Paseo 0.12 or later with background workspaces. It reuses one dedicated background workspace with an empty context directory and removes each helper session after its request. The empty workspace remains for reuse. Only these helper sessions are removed. The plugin does not send messages to, approve permissions for, stop, delete, archive, or resume your existing sessions or goals. Turning off title shortening cancels its helper and ignores late results.

Conversation excerpts stay in the plugin's memory and are never sent to another model. Settings are stored by Paseo; content-free attempt records prevent repeated title requests across reloads. Requires stable Paseo 0.11.4 or later.
