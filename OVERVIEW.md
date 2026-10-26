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

The optional Update title icons setting updates session and workspace markers after lifecycle events. Existing title-update preferences are respected. Changes are queued one at a time, repeated events are merged, and unchanged titles are skipped. When a completed-turn event includes recent messages, the plugin uses those items. Paseo 0.13 sends no message content in this event; metadata updates the icon, and Check reply classifies the response when requested. No background conversation scan is added. The plugin does not send messages, approve permissions, stop agents, delete sessions, or archive them.

Conversation excerpts stay in the plugin's memory. They are not sent to another model or external service. Settings are stored by Paseo. Requires stable Paseo 0.11.4 or later.
