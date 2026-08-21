const OFFSCREEN_URL = 'offscreen.html';

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Запись аудио вкладки и микрофона, отправка на локальный Whisper-сервер.'
  });
}

async function getActiveMeetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes('meet.google.com')) return tab;
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'background') return false;

  (async () => {
    if (message.type === 'start-recording') {
      const tab = await getActiveMeetTab();
      if (!tab) {
        sendResponse({ ok: false, error: 'Откройте вкладку meet.google.com и повторите.' });
        return;
      }
      try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        await ensureOffscreenDocument();
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'start-recording', streamId });
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

  return true; // держим канал открытым для async sendResponse
});
