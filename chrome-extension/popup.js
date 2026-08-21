const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const tabInfoEl = document.getElementById('tab-info');

let activeTab = null;

async function renderTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:\/\//.test(tab.url)) {
      activeTab = tab;
      tabInfoEl.textContent = `Вкладка: ${new URL(tab.url).hostname}`;
    } else {
      activeTab = null;
      tabInfoEl.textContent = 'Не удалось определить вкладку для записи.';
    }
  } catch {
    activeTab = null;
    tabInfoEl.textContent = '';
  }
}
renderTabInfo();

function render(state) {
  const { status, transcript, error } = state;
  transcriptEl.value = transcript || '';

  if (status === 'recording') {
    statusEl.textContent = 'Идёт запись встречи... Можно закрыть это окно — запись продолжится.';
    startBtn.disabled = true; stopBtn.disabled = false;
  } else if (status === 'transcribing') {
    statusEl.textContent = 'Отправляю запись на локальный Whisper-сервер...';
    startBtn.disabled = true; stopBtn.disabled = true;
  } else if (status === 'done') {
    statusEl.textContent = 'Готово! Расшифровка ниже.';
    startBtn.disabled = false; stopBtn.disabled = true;
  } else if (status === 'error') {
    statusEl.textContent = error || 'Произошла ошибка.';
    startBtn.disabled = false; stopBtn.disabled = true;
  } else {
    statusEl.textContent = 'Откройте вкладку с видеовстречей и нажмите «Начать запись».';
    startBtn.disabled = false; stopBtn.disabled = true;
  }
}

chrome.storage.local.get(['status', 'transcript', 'error'], render);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  chrome.storage.local.get(['status', 'transcript', 'error'], render);
});

startBtn.addEventListener('click', () => {
  if (!activeTab) {
    statusEl.textContent = 'Не удалось определить вкладку для записи. Обновите вкладку со встречей и откройте попап заново.';
    return;
  }
  // Если разрешения на микрофон ещё нет, background откроет отдельную вкладку
  // для запроса — из-за этого попап может закрыться сам (теряет фокус), это
  // нормально: весь дальнейший flow идёт в background и попапа не требует.
  statusEl.textContent = 'Начинаю...';
  chrome.runtime.sendMessage({ target: 'background', type: 'start-recording', tabId: activeTab.id }, (res) => {
    if (!res || !res.ok) {
      statusEl.textContent = (res && res.error) || 'Не удалось начать запись.';
    }
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ target: 'background', type: 'stop-recording' });
});

document.getElementById('copy').addEventListener('click', () => {
  navigator.clipboard.writeText(transcriptEl.value);
});

document.getElementById('download').addEventListener('click', () => {
  const blob = new Blob([transcriptEl.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'meet-transcript.txt' });
});
