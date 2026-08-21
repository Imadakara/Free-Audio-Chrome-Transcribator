// Адрес вашего локального Whisper-сервера (см. папку whisper-server)
const WHISPER_SERVER_URL = 'http://127.0.0.1:8000/transcribe';

let mediaRecorder;
let recordedChunks = [];
let micStream;
let tabStream;
let audioContext;

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;
  if (message.type === 'start-recording') startRecording(message.streamId);
  if (message.type === 'stop-recording') stopRecording();
});

async function startRecording(streamId) {
  recordedChunks = [];
  await chrome.storage.local.set({ status: 'recording', transcript: '', error: '' });

  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  audioContext = new AudioContext();

  // Захват вкладки по умолчанию "глушит" звук для вас — явно проигрываем его обратно,
  // иначе встреча замолчит, пока идёт запись.
  const tabSource = audioContext.createMediaStreamSource(tabStream);
  tabSource.connect(audioContext.destination);

  // Подмешиваем микрофон, иначе в расшифровке останутся только собеседники, а не вы.
  let micSource = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micSource = audioContext.createMediaStreamSource(micStream);
  } catch (err) {
    console.warn('Микрофон недоступен, будет записан только звук вкладки.', err);
  }

  const destination = audioContext.createMediaStreamDestination();
  tabSource.connect(destination);
  if (micSource) micSource.connect(destination);

  mediaRecorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = handleStop;
  mediaRecorder.start(1000);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  [tabStream, micStream].forEach((stream) => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  });
  if (audioContext) audioContext.close();
}

async function handleStop() {
  await chrome.storage.local.set({ status: 'transcribing' });

  const blob = new Blob(recordedChunks, { type: 'audio/webm' });
  const form = new FormData();
  form.append('audio', blob, 'meeting.webm');

  try {
    const res = await fetch(WHISPER_SERVER_URL, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
    const data = await res.json();
    await chrome.storage.local.set({ status: 'done', transcript: data.text || '' });
  } catch (err) {
    await chrome.storage.local.set({
      status: 'error',
      error: `Не удалось связаться с локальным сервером (${WHISPER_SERVER_URL}). Убедитесь, что whisper_server.py запущен. Детали: ${err.message}`
    });
  }
}
