const OFFSCREEN_URL = 'offscreen.html';
const PERMISSION_URL = 'permission.html';

// Reset the previous recording's result only on a genuine extension restart
// (Reload on chrome://extensions, an update, a fresh install) — onInstalled
// fires exactly for that, unlike a regular service worker wake-up (it goes to
// sleep/wakes up in the background constantly; resetting on every wake-up
// would wipe a result that just finished while the user is looking at it).
// micGranted is left alone — no reason to re-prompt for mic access on every Reload.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ status: 'idle', transcript: '', error: '' });
});

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Recording tab and microphone audio, sending it to the local Whisper server.'
  });
}

// Mic permission can't be requested from the offscreen document (no visible
// surface for the dialog) nor from the popup (the popup closes on losing focus,
// which is exactly what happens the moment the dialog appears, so getUserMedia
// fails with "Permission dismissed"). So we open a separate stable tab
// (permission.html), wait for its result, and close it ourselves. A successful
// result is cached in storage so we don't have to open the tab again next time.
let pendingMicPermissionResolve = null;

async function ensureMicPermission() {
  const { micGranted } = await chrome.storage.local.get('micGranted');
  if (micGranted) return true;

  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(PERMISSION_URL), active: true });
  const granted = await new Promise((resolve) => {
    pendingMicPermissionResolve = resolve;
  });
  await chrome.tabs.remove(tab.id).catch(() => {});
  if (granted) await chrome.storage.local.set({ micGranted: true });
  return granted;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'background') return false;

  (async () => {
    if (message.type === 'set-state') {
      // The offscreen document can't write to chrome.storage itself (it's
      // undefined there), so it asks us to do it.
      await chrome.storage.local.set(message.patch);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'mic-permission-result') {
      if (pendingMicPermissionResolve) {
        pendingMicPermissionResolve(message.granted);
        pendingMicPermissionResolve = null;
      }
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'start-recording') {
      // tabId comes from the popup: the popup always has a real browser window
      // behind it, so its chrome.tabs.query(currentWindow:true) is reliable.
      // No need to query the tab again here, in the service worker — it has no
      // "own" window, so currentWindow/lastFocusedWindow filters there are
      // unreliable (empty, e.g. when some other window like DevTools has OS focus).
      const tabId = message.tabId;
      const micEnabled = message.micEnabled !== false; // popup toggle, on by default
      if (!tabId) {
        sendResponse({ ok: false, error: 'Open a tab with a video call in the browser and try again.' });
        return;
      }
      try {
        // The whole mic-permission flow happens here, not in the popup: opening
        // the permission.html tab steals focus and closes the popup (it closes
        // on losing focus), so the popup wouldn't have survived to this point
        // anyway. The service worker isn't subject to being closed like that —
        // it sees this through to the end on its own.
        // If the mic is disabled by the popup toggle, we don't touch permission
        // at all — the permission.html tab never appears.
        if (micEnabled) {
          const micGranted = await ensureMicPermission();
          if (!micGranted) {
            await chrome.storage.local.set({
              error: 'Microphone unavailable — if you continue, only tab audio will be recorded.'
            });
          }
        }
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        await ensureOffscreenDocument();
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'start-recording', streamId, micEnabled });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    }

    if (message.type === 'stop-recording') {
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-recording' });
      sendResponse({ ok: true });
    }
  })();

  return true; // keep the channel open for async sendResponse
});
