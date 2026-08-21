const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const tabInfoEl = document.getElementById('tab-info');
const micToggleEl = document.getElementById('mic-toggle');
const micToggleLabelEl = document.getElementById('mic-toggle-label');
const copyBtn = document.getElementById('copy');
const downloadBtn = document.getElementById('download');

let activeTab = null;

// "Record microphone" toggle — the preference is remembered across popup opens
// (chrome.storage.local, key micEnabled), on by default (keeps prior behavior).
// Useful e.g. on a YouTube tab — you don't want your own voice in the transcript.
chrome.storage.local.get(['micEnabled'], (state) => {
  micToggleEl.checked = state.micEnabled !== false;
});
micToggleEl.addEventListener('change', () => {
  chrome.storage.local.set({ micEnabled: micToggleEl.checked });
});

async function renderTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:\/\//.test(tab.url)) {
      activeTab = tab;
      tabInfoEl.textContent = `Tab: ${new URL(tab.url).hostname}`;
    } else {
      activeTab = null;
      tabInfoEl.textContent = 'Could not determine a tab to record.';
    }
  } catch {
    activeTab = null;
    tabInfoEl.textContent = '';
  }
}
renderTabInfo();

const EMPTY_TRANSCRIPT_MESSAGE = 'The transcript is empty — it looks like no speech was '
  + 'recognized in the recording (silence or noise). Check your microphone/tab audio and try again.';

function render(state) {
  const { status, transcript, error } = state;

  const busy = status === 'recording' || status === 'transcribing';
  micToggleEl.disabled = busy;
  micToggleLabelEl.classList.toggle('disabled', busy);

  // Whisper sometimes honestly returns an empty string (silence/noise) instead of
  // an error — status is still 'done' in that case. Catch this case separately and
  // highlight it right in the text box instead of silently showing a blank field.
  const isEmptyDone = status === 'done' && !(transcript || '').trim();
  transcriptEl.classList.toggle('error', isEmptyDone || status === 'error');
  transcriptEl.value = isEmptyDone ? EMPTY_TRANSCRIPT_MESSAGE : (transcript || '');

  const hasRealTranscript = status === 'done' && !isEmptyDone;
  copyBtn.disabled = !hasRealTranscript;
  downloadBtn.disabled = !hasRealTranscript;

  if (status === 'recording') {
    statusEl.textContent = 'Recording the call... You can close this window — recording will continue.';
    startBtn.disabled = true; stopBtn.disabled = false;
  } else if (status === 'transcribing') {
    statusEl.textContent = 'Sending the recording to the local Whisper server...';
    startBtn.disabled = true; stopBtn.disabled = true;
  } else if (status === 'done') {
    statusEl.textContent = isEmptyDone ? 'Empty transcript — see the message below.' : 'Done! Transcript below.';
    startBtn.disabled = false; stopBtn.disabled = true;
  } else if (status === 'error') {
    statusEl.textContent = error || 'An error occurred.';
    startBtn.disabled = false; stopBtn.disabled = true;
  } else {
    statusEl.textContent = 'Open a tab with a video call and click "Start recording".';
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
    statusEl.textContent = 'Could not determine a tab to record. Reload the tab with the call and reopen the popup.';
    return;
  }
  // If mic permission isn't granted yet, background will open a separate tab to
  // request it — this may cause the popup to close on its own (loses focus), which
  // is fine: the rest of the flow runs in background and doesn't need the popup.
  statusEl.textContent = 'Starting...';
  chrome.runtime.sendMessage({
    target: 'background',
    type: 'start-recording',
    tabId: activeTab.id,
    micEnabled: micToggleEl.checked
  }, (res) => {
    if (!res || !res.ok) {
      statusEl.textContent = (res && res.error) || 'Could not start recording.';
    }
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ target: 'background', type: 'stop-recording' });
});

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(transcriptEl.value);
});

downloadBtn.addEventListener('click', () => {
  const blob = new Blob([transcriptEl.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'meeting-transcript.txt' });
});
