// A separate stable tab purely for requesting mic permission. The extension
// popup can't be used for this — it closes on losing focus, which is exactly
// what happens the moment Chrome's system dialog appears, and getUserMedia
// then fails with "Permission dismissed" instead of a real answer.
(async () => {
  const statusEl = document.getElementById('status');
  let granted = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    granted = true;
    statusEl.textContent = 'Access granted. This tab will close automatically.';
  } catch (err) {
    statusEl.textContent = `Could not get microphone access: ${err.message}. You can close this tab.`;
  }
  chrome.runtime.sendMessage({ target: 'background', type: 'mic-permission-result', granted });
})();
