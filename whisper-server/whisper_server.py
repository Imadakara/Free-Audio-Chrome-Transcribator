"""
Локальный сервер расшифровки для расширения "Meet Local Transcriber".

Установка:
    pip install flask flask-cors openai-whisper
    (нужен ffmpeg в PATH: https://ffmpeg.org/download.html)

Запуск:
    python whisper_server.py

Сервер слушает http://127.0.0.1:8000/transcribe и работает только локально.
Ничего никуда в интернет не отправляется.

Модель и язык можно переопределить переменными окружения, например:
    WHISPER_MODEL=small WHISPER_LANGUAGE=ru python whisper_server.py
"""
import os
import tempfile

from flask import Flask, request, jsonify
from flask_cors import CORS
import whisper

MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")  # tiny/base/small/medium/large
LANGUAGE = os.environ.get("WHISPER_LANGUAGE")  # напр. "ru"; не задавайте — для автоопределения

app = Flask(__name__)
CORS(app)  # расширение обращается с chrome-extension://..., разрешаем локально

print(f"Загружаю модель Whisper '{MODEL_NAME}'... (в первый раз может скачаться и занять пару минут)")
model = whisper.load_model(MODEL_NAME)
print("Модель загружена. Сервер готов принимать запросы на http://127.0.0.1:8000/transcribe")


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "no audio file in request"}), 400

    audio_file = request.files["audio"]
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        result = model.transcribe(tmp_path, language=LANGUAGE, fp16=False)
        text = result["text"].strip()
        print(f"[transcribe] определён язык: {result.get('language')}, длина текста: {len(text)}, текст: {text!r}")
        return jsonify({"text": text})
    except Exception as exc:  # noqa: BLE001 - хотим вернуть текст ошибки клиенту
        return jsonify({"error": str(exc)}), 500
    finally:
        os.remove(tmp_path)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000)
