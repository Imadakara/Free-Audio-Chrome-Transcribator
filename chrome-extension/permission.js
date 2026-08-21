// Отдельная стабильная вкладка только для запроса разрешения на микрофон.
// Попап расширения для этого не годится — он закрывается при потере фокуса,
// а именно это происходит в момент показа системного диалога Chrome, и
// getUserMedia падает с "Permission dismissed" вместо реального ответа.
(async () => {
  const statusEl = document.getElementById('status');
  let granted = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    granted = true;
    statusEl.textContent = 'Доступ получен. Эта вкладка закроется автоматически.';
  } catch (err) {
    statusEl.textContent = `Не удалось получить доступ к микрофону: ${err.message}. Можно закрыть эту вкладку.`;
  }
  chrome.runtime.sendMessage({ target: 'background', type: 'mic-permission-result', granted });
})();
