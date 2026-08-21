"""
Local transcription server for the "Free Audio Chrome Transcribator" extension.

Install:
    pip install flask flask-cors openai-whisper
    (ffmpeg must be on PATH: https://ffmpeg.org/download.html)

Run:
    python whisper_server.py

The server listens on http://127.0.0.1:8000/transcribe and works locally only.
Nothing is ever sent to the internet.

Model and language can be overridden with environment variables, e.g.:
    WHISPER_MODEL=small WHISPER_LANGUAGE=ru python whisper_server.py
"""
import os
import sys
import tempfile
import threading
import time

from flask import Flask, request, jsonify
from flask_cors import CORS
import whisper

MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")  # tiny/base/small/medium/large
LANGUAGE = os.environ.get("WHISPER_LANGUAGE")  # e.g. "ru"; leave unset for auto-detect

app = Flask(__name__)
CORS(app)  # the extension calls from chrome-extension://..., allow it locally

print(f"Loading Whisper model '{MODEL_NAME}'... (first run may download it, takes a couple of minutes)")
model = whisper.load_model(MODEL_NAME)
print("Model loaded. Server ready to accept requests at http://127.0.0.1:8000/transcribe")


class Spinner:
    """A spinning indicator in the terminal for the duration of a long operation
    (transcribe blocks the thread for tens of seconds, otherwise the terminal
    stays silent the whole time)."""

    FRAMES = "|/-\\"

    def __init__(self, label):
        self.label = label
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._spin, daemon=True)
        self.start_time = time.time()

    def _spin(self):
        i = 0
        while not self._stop.is_set():
            elapsed = time.time() - self.start_time
            sys.stdout.write(f"\r{self.label} {self.FRAMES[i % len(self.FRAMES)]} ({elapsed:.0f}s)  ")
            sys.stdout.flush()
            i += 1
            time.sleep(0.2)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._stop.set()
        self._thread.join()
        sys.stdout.write("\r" + " " * 60 + "\r")  # clear the spinner line
        sys.stdout.flush()
        self.elapsed = time.time() - self.start_time


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "no audio file in request"}), 400

    audio_file = request.files["audio"]
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    print("[transcribe] file received, starting transcription...")
    try:
        with Spinner("[transcribe] processing...") as spinner:
            result = model.transcribe(tmp_path, language=LANGUAGE, fp16=False)
        text = result["text"].strip()
        print(
            f"[transcribe] done in {spinner.elapsed:.1f}s — detected language: "
            f"{result.get('language')}, text length: {len(text)}, text: {text!r}"
        )
        return jsonify({"text": text})
    except Exception as exc:  # noqa: BLE001 - want to return the error text to the client
        print(f"[transcribe] error: {exc}")
        return jsonify({"error": str(exc)}), 500
    finally:
        os.remove(tmp_path)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000)
