# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chrome extension (Manifest V3) that one-click records the active browser tab (any site — not
tied to a specific meeting engine, participant audio + your mic, mixed) and sends the recording
to a local Whisper server for transcription. Nothing leaves the machine — no cloud calls. Two
independent pieces, no build step, no package.json, no tests:

- `chrome-extension/` — the MV3 extension (vanilla JS, no bundler)
- `whisper-server/` — a small local Flask server wrapping `openai-whisper`

## Running / developing

No build/lint/test commands exist in this repo — it's plain JS + one Python file.

**Whisper server:**
```bash
cd whisper-server
pip install -r requirements.txt   # needs ffmpeg in PATH too
python whisper_server.py
```
Model/language are env vars, not CLI flags or config file (bash shown; on Windows PowerShell the
inline `VAR=val cmd` form doesn't work — use `$env:WHISPER_MODEL = "small"` etc. as separate
statements first):
```bash
WHISPER_MODEL=small WHISPER_LANGUAGE=ru python whisper_server.py
```
`WHISPER_MODEL` default `base` (tiny/base/small/medium/large). `WHISPER_LANGUAGE` unset =
auto-detect — unreliable on short/quiet audio, prefer setting it explicitly when the spoken
language is known.
Server listens on `http://127.0.0.1:8000/transcribe`, POST only, `multipart/form-data` field
`audio`. Every request logs `[transcribe] определён язык: ..., длина текста: ..., текст: ...`
to the server's own terminal (detected language, text length, raw text) — the first thing to
check when a transcript looks wrong; text length 0 means the uploaded audio was silent
server-side, not a model problem.

**Extension:** load unpacked via `chrome://extensions` → Developer mode → Load unpacked →
select `chrome-extension/` folder. Reload from that page after editing any file (background
service worker and offscreen document don't hot-reload).

## Architecture (the part that needs multiple files to understand)

MV3 service workers can't touch `MediaStream`/`MediaRecorder` directly, so recording is split
across four contexts that talk only via `chrome.runtime.sendMessage` (routed by a `target`
field, always `'background'` or `'offscreen'`) and `chrome.storage.local` (routed by a `status`
field: `idle → recording → transcribing → done|error`):

- **`popup.js`** — thin view. Reads/writes `chrome.storage.local` and relays button clicks to
  `background.js`. Because state lives in storage rather than the popup, closing the popup during
  recording is safe — `popup.html` re-renders from storage on next open, and `storage.onChanged`
  keeps it live while open. Also the only place that resolves *which* tab to capture: on open it
  runs `chrome.tabs.query({active:true, currentWindow:true})` (reliable here — the popup always
  has a real browser window backing it) to show the tab's hostname in `#tab-info` and to get the
  `tab.id` sent along with the `start-recording` message. Note the popup **does not** wait around
  for anything past that click — see the mic-permission gotcha below for why, and don't add logic
  here that assumes the popup stays open after "Начать запись" is clicked.
- **`background.js`** — service worker, the actual orchestrator. Takes the `tabId` the popup
  already resolved, ensures mic permission (see below), calls `chrome.tabCapture.getMediaStreamId`,
  lazily creates the offscreen document (`chrome.offscreen.createDocument`, singleton via
  `chrome.runtime.getContexts` check), then forwards start/stop messages to it. Deliberately does
  not call `chrome.tabs.query` itself — a service worker has no associated browser window, so
  `currentWindow`/`lastFocusedWindow` filters there resolve unreliably (can silently return `[]`,
  e.g. when a DevTools window currently has OS focus instead of the browser window). The popup's
  context always has a real window, so tab resolution lives there and the id is threaded through.
- **`offscreen.js`** — does the actual media work. Captures the tab stream via
  `getUserMedia({ mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } })`, re-routes it
  to `audioContext.destination` (tab capture mutes the tab by default — must be replayed or the
  meeting goes silent for the recording user), separately captures the mic, mixes both into one
  `MediaStreamAudioDestinationNode`, records that with `MediaRecorder`
  (`audio/webm;codecs=opus`), and on stop POSTs the blob to `WHISPER_SERVER_URL`
  (`http://127.0.0.1:8000/transcribe`, hardcoded at the top of the file — the only place to
  change the server address). **`chrome.storage` is `undefined` inside the offscreen document**
  (confirmed empirically — `chrome.runtime` works fine there, `chrome.storage` does not), so
  `offscreen.js` never touches storage directly. Instead it sends `{ target: 'background', type:
  'set-state', patch }` messages, and `background.js` performs the actual
  `chrome.storage.local.set(patch)` on its behalf. Keep this pattern for any new state
  offscreen.js needs to report — don't reintroduce a direct `chrome.storage` call there.
- **`permission.html` / `permission.js`** — exists solely to get the mic permission prompt in
  front of the user. Opened as a real, focused tab by `background.js`'s `ensureMicPermission()`
  (only once per install — success is cached as `micGranted` in `chrome.storage.local`), calls
  `getUserMedia({audio:true})`, stops the resulting tracks immediately, reports the result via
  `chrome.runtime.sendMessage({target:'background', type:'mic-permission-result', granted})`, and
  gets closed by `background.js` (`chrome.tabs.remove`) once that arrives.

  **Why this exists — two stacked gotchas, don't undo either fix:**
  1. Offscreen documents cannot show *any* permission prompt (no visible surface to click
     "Allow" on) — a bare `getUserMedia({audio:true})` inside `offscreen.js` silently rejects
     unless the origin already has the grant. Symptom if reintroduced: recording "succeeds" but
     only captures near-silent tab audio, and Whisper hallucinates boilerplate text on the
     silence (observed: Russian subtitle-credit filler) instead of erroring.
  2. The natural fix — request the permission from the popup instead — also fails, differently:
     **extension popups close the instant they lose focus, and showing the native mic-permission
     dialog itself shifts focus away from the popup**, tearing down its script mid-request. This
     surfaces as `getUserMedia` rejecting with `NotAllowedError: Permission dismissed`, with no
     dialog visibly shown to the user (it appeared and vanished with the popup). Only a page in
     its own stable tab (not a popup, not an offscreen document) can reliably host this prompt —
     hence `permission.html`, opened as a real tab by `background.js`. Because opening that tab
     itself steals focus and closes the popup, the entire `start-recording` flow (permission →
     tabCapture → offscreen) lives in `background.js`, not split across a popup round-trip —
     the popup fires one message and may not survive to see the response.

Mixing tab audio + mic is deliberate, not incidental: recording only the tab means only the
other participants get transcribed, not the user. Any change to the audio pipeline should
preserve both sources feeding the same `MediaRecorder`.

`whisper_server.py` is intentionally minimal (single `/transcribe` route): writes the uploaded
blob to a temp `.webm`, runs `whisper.load_model(...).transcribe(...)` (model loaded once at
startup, not per-request), returns `{"text": ...}` or `{"error": ...}` with 500. Swapping in
`faster-whisper` instead of `openai-whisper` is expected to be a same-shaped drop-in per the
README — keep the request/response contract (`multipart` `audio` in, `{"text"}` JSON out) stable
if doing that.

## Permissions note

`manifest.json` host_permissions are scoped to `127.0.0.1`/`localhost` only — if the Whisper
server address ever becomes configurable, host_permissions must be updated too or the fetch in
offscreen.js will be blocked.
