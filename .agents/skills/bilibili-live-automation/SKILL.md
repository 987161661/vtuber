---
name: bilibili-live-automation
description: Operate and diagnose this VTuber project's local Bilibili live-room automation bridge, including room configuration, supervisor lifecycle, outbound text replies, local authentication, health checks, event sampling, and logs. Use when Codex is asked to connect the project to Bilibili, automate Bilibili live-room monitoring or replies, manage the local Bilibili supervisor, inspect comments or audience events, troubleshoot the Bilibili bridge, or perform explicitly requested creator-center actions through a signed-in browser.
---

# Bilibili Live Automation

Reuse the existing supervisor and `room-event`/`status` SSE protocol. Do not
create a second Bilibili listener.

## Workflow

1. Run `status` before changing the runtime.
2. Use `configure` only with a numeric public room ID. Add self UIDs when the
   broadcaster's own events must be ignored.
3. Use `start` to launch the hidden, restart-on-failure supervisor. Treat an
   already healthy supervisor for the same room as success.
4. Verify `state` is `online`, `requestedRoomId` matches, and live rooms have a
   connected SSE client when the app should be listening.
5. Use `events` for a short protocol sample and `logs` or `diagnose` for faults.
6. Keep the app-side platform set to `bilibili` with Bilibili monitoring enabled.
   Use the existing app UI when its browser-local settings need changing.
7. For outbound speech mirroring, verify `bridge.outbound.configured`. Before
   the first account check/send, `bridge.outbound.authenticated` can still be
   false. Enable the app's Bilibili text-reply switch only after local
   authentication is configured.

Run the deterministic wrapper from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .agents/skills/bilibili-live-automation/scripts/invoke-bilibili-automation.ps1 -Action status
```

Supported actions:

- `configure -RoomId <digits> [-SelfUid <digits[,digits...]>]`
- `configure-auth` (interactive; run in the user's terminal)
- `clear-auth`
- `start [-RoomId <digits>] [-WaitSeconds 20]`
- `stop`
- `status`
- `diagnose`
- `events [-Seconds 10]`
- `logs [-Tail 80]`

For protocol or runtime details, inspect
`aituber-onair-main/docs/bilibili-unattended-live.md` and
`aituber-onair-main/scripts/bilibili-room-supervisor.mjs`.

## Account-facing operations

Outbound danmu uses the local ignored `.runtime/bilibili-auth.json` file. Never
ask the user to paste a Cookie into chat or pass it on a command line. Have the
user run `configure-auth` in their terminal and paste the `Cookie` request
header from a signed-in `live.bilibili.com` request into the hidden prompt.
The supervisor reads this file dynamically; a restart is not required.

`POST /send` accepts JSON with `message` and `idempotencyKey`. It splits long
text, rate-limits chunks, resumes partial sends, and suppresses duplicates for
the same event ID. The app calls it once when real TTS starts, using the final
prepared text for replies, proactive speech, and operator broadcasts. It never
sends partial model output or stress-test text.

Use the available Chrome control skill for signed-in Bilibili creator-center or
live-center UI work. Inspect the current page before acting. Publish, delete,
edit public metadata, or start/stop a real broadcast only when the user
explicitly requests that external action.

## Safety boundaries

- Keep credentials, cookies, `SESSDATA`, and browser profiles out of the repo.
- Keep outbound replies opt-in. Do not send a real test danmu unless the user
  explicitly authorizes that public message.
- Never print or return Cookie, `SESSDATA`, `bili_jct`, or CSRF values. Health
  output may expose only safe configured/authenticated state and account UID.
- Stop only the supervisor process recorded by this skill. Never kill an
  arbitrary process merely because it owns the configured port.
- Preserve the standard `room-event` and `status` schema so all platform
  adapters remain composable.
