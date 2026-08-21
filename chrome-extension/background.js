const OFFSCREEN_URL = 'offscreen.html';
const PERMISSION_URL = 'permission.html';

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

// Разрешение на микрофон нельзя запрашивать ни из offscreen-документа (нет
// видимой поверхности для диалога), ни из попапа (попап закрывается при
// потере фокуса — а именно это происходит в момент показа диалога, из-за
// чего getUserMedia падает с "Permission dismissed"). Поэтому открываем
// отдельную стабильную вкладку permission.html, ждём от неё результата и
// закрываем её сами. Успешный результат кэшируем в storage, чтобы не
// дёргать вкладку повторно при следующих записях.
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
      // offscreen-документ не может сам писать в chrome.storage (там оно undefined),
      // поэтому пишет через нас.
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
      // tabId приходит от попапа: у попапа всегда есть привязка к реальному окну
      // браузера, поэтому его chrome.tabs.query(currentWindow:true) надёжен.
      // Запрашивать вкладку заново тут, в service worker, не надо — у него нет
      // "своего" окна, currentWindow/lastFocusedWindow оттуда ненадёжны
      // (пусто, если, например, в фокусе стороннее окно вроде DevTools).
      const tabId = message.tabId;
      if (!tabId) {
        sendResponse({ ok: false, error: 'Откройте вкладку с видеовстречей в браузере и повторите.' });
        return;
      }
      try {
        // Весь flow разрешения на микрофон делаем здесь, а не в попапе: открытие
        // вкладки permission.html крадёт фокус и закрывает попап (он закрывается
        // при потере фокуса), так что попап всё равно не дожил бы до этого места.
        // Service worker закрытию попапа не подвержен — доводит дело до конца сам.
        const micGranted = await ensureMicPermission();
        if (!micGranted) {
          await chrome.storage.local.set({
            error: 'Микрофон недоступен — если продолжите, в записи будет только звук вкладки.'
          });
        }
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
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
