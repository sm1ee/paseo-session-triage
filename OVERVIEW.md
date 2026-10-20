# Session triage

See the Paseo sessions that need your attention in one place. Open a session from the list, or check the attention count in the desktop and web sidebar. The sidebar shortcut is hidden in the iOS and Android apps; open Session triage from the Command Center there.

The icons mean:

- 🔴 **Error:** Paseo reports an agent error.
- ❓ **Needs your input:** A permission request is pending, or the agent asks for a decision or reply.
- 📤 **Ready to send:** A draft appears ready for you to review and send.
- 🟠 **Needs review:** The work is unfinished, or the latest update is unclear.
- 👀 **Waiting on a result:** The agent appears to be waiting for CI, a build, a deployment, or a review.
- ⏳ **Working:** The agent is running a turn or starting up.
- ✅ **Done:** The latest reply says the work is done. Check the result yourself.

Session triage reads the current Paseo state and a short stretch of each recently changed session's timeline. Pending permissions and errors come from Paseo. Labels inferred from chat wording can be wrong; ✅ does not verify a build, test, deployment, or submission.

By default, it shows the 20 most recent top-level sessions. Settings let you include subagents and change the limit. The screen and sidebar check for updates while open, and you can refresh the list yourself.

Title updates are optional and off by default. If enabled, the plugin adds an emoji to session names through the local Paseo CLI and to workspace names through the Paseo API. Turning the option off does not restore names already changed. It does not send messages, approve permissions, stop agents, delete sessions, or archive them.

Conversation excerpts stay in the plugin's memory. They are not sent to another model or external service. Settings are stored by Paseo. Requires Paseo 0.11.4 or later.
