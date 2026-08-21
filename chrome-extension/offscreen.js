// Address of your local Whisper server (see the whisper-server folder)
const WHISPER_SERVER_URL = 'http://127.0.0.1:8000/transcribe';

let mediaRecorder;
let recordedChunks = [];
let micStream;
let tabStream;
let audioContext;

// chrome.storage is not accessible directly in the offscreen document (verified
// empirically — it's undefined there, even though chrome.runtime works fine). So
// we don't write status here ourselves — we ask background (chrome.storage works
// there) to write it on our behalf.
function setState(patch) {
  chrome.runtime.sendMessage({ target: 'background', type: 'set-state', patch });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'offscreen') return;
  if (message.type === 'start-recording') startRecording(message.streamId, message.micEnabled);
  if (message.type === 'stop-recording') stopRecording();
});

async function startRecording(streamId, micEnabled) {
  recordedChunks = [];
  setState({ status: 'recording', transcript: '', error: '' });

  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
  } catch (err) {
    setState({ status: 'error', error: `Could not capture tab audio: ${err.message}` });
    return;
  }

  audioContext = new AudioContext();

  // Tab capture mutes the tab by default for you — explicitly play it back,
  // otherwise the call goes silent for you while recording.
  const tabSource = audioContext.createMediaStreamSource(tabStream);
  tabSource.connect(audioContext.destination);

  // Mix in the microphone, otherwise only the other participants end up in the
  // transcript, not you. Can be turned off with the popup toggle (e.g. on a tab
  // with no conversation, where you don't want your own voice in the transcript).
  let micSource = null;
  if (micEnabled) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micSource = audioContext.createMediaStreamSource(micStream);
    } catch (err) {
      console.warn('Microphone unavailable, only tab audio will be recorded.', err);
    }
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
  setState({ status: 'transcribing' });

  const blob = new Blob(recordedChunks, { type: 'audio/webm' });
  const form = new FormData();
  form.append('audio', blob, 'meeting.webm');

  try {
    const res = await fetch(WHISPER_SERVER_URL, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    setState({ status: 'done', transcript: data.text || '' });
  } catch (err) {
    setState({
      status: 'error',
      error: `Could not reach the local server (${WHISPER_SERVER_URL}). Make sure whisper_server.py is running. Details: ${err.message}`
    });
  }
}
