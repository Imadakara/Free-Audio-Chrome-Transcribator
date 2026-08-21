# Free Audio Chrome Transcribator

A Chrome extension that records the active browser tab of a video call in one click
(any service — Google Meet, Yandex Telemost, Zoom web client, or anything else — participant
audio + your microphone, mixed) and sends the recording to your own local Whisper server for
transcription. Everything stays on your machine — nothing goes to the cloud.

## Features

- One-click recording of any active browser tab — not tied to a specific meeting service.
- Mixes tab audio with your microphone so both sides of the conversation end up in the transcript.
- **"Record microphone" toggle** in the popup — turn it off when you only need the tab's audio
  (e.g. transcribing a YouTube video) and don't want your own voice mixed in. Remembered between
  popup opens.
- The popup shows the hostname of the tab about to be recorded, so you can confirm it's the right one.
- Recording continues even if you close the popup — state is kept in `chrome.storage.local` and
  the popup re-renders from it next time you open it.
- 100% local: transcription runs on your own machine via `openai-whisper`, nothing is uploaded anywhere.
- The whisper server terminal shows a live spinner while a request is being transcribed, and a
  `done in Ns` line with the detected language/text length when it finishes.

## Requirements

- Google Chrome (or another Chromium-based browser that supports Manifest V3 extensions).
- Python 3.9+ and [ffmpeg](https://ffmpeg.org/download.html) on `PATH`, to run the local Whisper server.

## Quick start

### 1. Run the local transcription server

```bash
cd whisper-server
pip install -r requirements.txt
# needs ffmpeg on PATH: https://ffmpeg.org/download.html (macOS: brew install ffmpeg)
python whisper_server.py
```

Keep this terminal window open — the server needs to keep running during your calls. While a
request is being transcribed you'll see a spinner (`[transcribe] processing... | (Ns)`) so you
know the server is working, not stuck; when it's done you'll see a
`[transcribe] done in Ns — ...` line with the result (language, text length, text itself — see
[Troubleshooting](#troubleshooting) below, useful if the result looks off).

By default this uses the `base` model with language auto-detection. Both are environment
variables, set before starting `python whisper_server.py`, **not** command-line flags:

**Windows (PowerShell)** — the `VAR=val command` bash syntax doesn't work here, set variables as
separate statements:
```powershell
$env:WHISPER_MODEL = "small"
$env:WHISPER_LANGUAGE = "ru"
python whisper_server.py
```

**macOS / Linux (bash/zsh):**
```bash
WHISPER_MODEL=small WHISPER_LANGUAGE=ru python whisper_server.py
```

- `WHISPER_MODEL` — `tiny` → `base` → `small` → `medium` → `large`: more accurate but slower and
  heavier on memory/VRAM. For regular use, `small` or above is recommended — `base` with
  auto-detected language frequently mis-detects the language on short/quiet speech.
- `WHISPER_LANGUAGE` — a language code (`ru`, `en`, ...). If unset, the language is auto-detected
  from the first few seconds of audio, which is less reliable on short or quiet recordings. If
  you always speak the same language, set it explicitly — it's both faster and more accurate.
- The first run with a new model downloads its weights (a few hundred MB for `small`/`medium`),
  then it works fully offline.

### 2. Load the extension into Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `chrome-extension` folder

After editing the extension's files (if you do) — click **Reload** (circular arrow) on the
extension's card on that same page: the service worker and the offscreen document don't pick up
changes on the fly.

## Usage

1. Open a tab with a video call (Google Meet, Yandex Telemost, Zoom web client — any service)
2. Click the extension icon → the popup shows the active tab's hostname, confirm it's the right call
3. The **"Record microphone"** checkbox is on by default, and remembered between popup opens.
   Turn it off if you don't need your voice in the transcript (e.g. on a YouTube tab — there's no
   reply from you anyway, and with the mic on it would just mix in as noise).
4. **Start recording**
5. **Only the very first time, if the mic is enabled**: a separate tab opens asking for
   microphone access — allow it. It closes itself. This is a separate tab rather than a dialog
   inside the popup because Chrome popups close on losing focus, and showing the system
   permission dialog does exactly that — the dialog gets cut off before you can answer it inside
   a popup. This step won't repeat on later recordings (the permission is remembered). If the
   toggle is off, this tab never appears at all.
6. You can close the popup — recording continues in the background, the call isn't interrupted
7. When done, open the popup again → **Stop**
8. The Whisper server starts processing — its terminal shows a spinner with elapsed time and then
   a "done" line (see [Quick start](#1-run-the-local-transcription-server) above). After a few
   seconds/minutes (depending on recording length and model) the transcript appears in the popup
   — you can copy it or download it as .txt

## Important notes

- **Microphone + tab audio are mixed together**, if the "Record microphone" toggle is on —
  otherwise only the other participant would end up in the transcript, not you. Turn the toggle
  off if you don't need your voice.
- Works while the call's tab is open and active — don't close it during recording.
- Accuracy vs. speed is a trade-off of model size: `base` transcribes a minute of audio in a few
  seconds on CPU, `medium` is more accurate but noticeably slower without a GPU.
- This is an unpublished extension (loaded manually via "Developer mode") — publishing to the
  Chrome Web Store isn't covered by these instructions.

## Troubleshooting

- **The transcript is empty, or clearly not what you said** (a typical example — the model
  outputs something like credits/copyright text instead of speech) — this is a known Whisper
  hallucination on near-silence: the model is trained partly on YouTube subtitles and, absent
  real speech, sometimes "makes up" similarly styled text instead of returning an empty string or
  an error. It means the recording didn't contain real audio — check:
  - Mic permission for the extension hasn't been revoked: `chrome://settings/content/microphone`.
  - The call itself is using the same microphone as your system default.
  - In the server's terminal (see [Quick start](#1-run-the-local-transcription-server)) that
    request will show a line like
    `[transcribe] done in 2.1s — detected language: ru, text length: 0, text: ''` — a text length
    of zero confirms the server received silence, it's not a model issue.
- **Language auto-detection** is unreliable on short (seconds) or quiet recordings — if it keeps
  guessing the wrong language, set `WHISPER_LANGUAGE` explicitly (see
  [Quick start](#1-run-the-local-transcription-server)).
- If nothing happens after clicking "Start recording" — check three consoles: the popup's
  (right-click the icon → "Inspect popup"), the service worker's (`chrome://extensions` →
  the extension's card → "Service worker" link), and the offscreen document's (a link to
  `offscreen.html` appears on the same card, but only after recording has started at least once).

## Background

This started as a personal need for a meeting transcriber. The first working setup was a locally
installed Whisper (`python -m whisper --help` worked, transcribing a test recording worked too),
but it meant manually recording video with Xbox Game Bar and then running a transcription command
by hand — not exactly convenient. So the natural next step was a "one-click" solution built as a
Chrome extension paired with a local Whisper server.

The one non-obvious technical wrinkle: an MV3 service worker can't touch a `MediaStream`/
`MediaRecorder` directly, so recording goes through an offscreen document, and state (recording /
transcript ready) lives in `chrome.storage`, so you can close the popup mid-recording without worry.

What followed was a fair amount of hands-on debugging once the extension was actually tested live
rather than just read through — a service worker with no window context silently returning no
tabs, `chrome.storage` turning out to be `undefined` inside the offscreen document, and Chrome
popups closing the instant the native mic-permission dialog steals focus. All three are documented
in [`CLAUDE.md`](CLAUDE.md) alongside the rest of the architecture, for anyone extending this later.

This is a working scaffold, not a polished product — you may well need to adjust it for your
particular Whisper setup (if you use `faster-whisper` instead of `openai-whisper`, the server
file is easy to adapt — the endpoint's shape stays the same).
