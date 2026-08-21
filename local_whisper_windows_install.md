# Установка локального Whisper на Windows

## 1. Установить Python

Скачать Python с официального сайта:

https://www.python.org/downloads/windows/

При установке обязательно включить **Add Python to PATH**.

Проверить установку в PowerShell:

```powershell
python --version
```

## 2. Установить FFmpeg

В PowerShell:

```powershell
winget install Gyan.FFmpeg
```

После установки перезапустить PowerShell и проверить:

```powershell
ffmpeg -version
```

FFmpeg необходим Whisper для работы с аудио- и видеофайлами.

## 3. Установить Whisper

В PowerShell:

```powershell
python -m pip install -U openai-whisper
```

Проверить:

```powershell
python -m whisper --help
```

Если появилась справка — Whisper установлен.

## 4. Транскрибировать запись

Например, если файл находится здесь:

```text
C:\Users\Max\Videos\meeting.mp4
```

Запустить:

```powershell
python -m whisper "C:\Users\Max\Videos\Captures\meeting.mp4" --language Russian --model turbo
OR
python -m whisper "C:\Users\PC\Videos\Captures\meeting.mp4" --language Russian --output_format txt
OR
python -m whisper "C:\Users\PC\Videos\Captures\meeting.mp4" --language Russian --output_dir "C:\Users\PC\Videos\Captures" --output_format txt
```

Whisper сам обработает MP4 через FFmpeg.

При первом запуске модель `turbo` будет скачана и сохранена локально.

## 5. Результат

После обработки рядом с исходным видео появятся файлы:

```text
meeting.txt
meeting.srt
meeting.vtt
meeting.tsv
meeting.json
```

Основные варианты:

- `.txt` — обычная расшифровка текста;
- `.srt` — субтитры с таймкодами;
- `.vtt` — субтитры в формате WebVTT;
- `.json` — подробные данные транскрибации.

## Рекомендуемая команда

Для русскоязычной записи рабочего созвона:

```powershell
python -m whisper "meeting.mp4" --language Russian --model turbo
```

## Какую модель использовать

`turbo` — хороший вариант по соотношению скорости и качества. Это оптимизированная версия `large-v3`.

Ориентировочное потребление VRAM:

| Модель | VRAM |
|---|---:|
| tiny | ~1 ГБ |
| base | ~1 ГБ |
| small | ~2 ГБ |
| medium | ~5 ГБ |
| turbo | ~6 ГБ |
| large | ~10 ГБ |

На CPU Whisper тоже работает, но значительно медленнее.

Если есть NVIDIA GPU, можно настроить PyTorch с CUDA для ускорения обработки.

## Важно

Локальный Whisper не требует API-ключа и может работать полностью на твоём компьютере.

В отличие от Whisper API, локальная версия не ограничена лимитом загрузки файла в 25 MiB. Длинные записи обрабатываются последовательно, поэтому основное ограничение — производительность и доступная память компьютера.

## Официальный репозиторий

OpenAI Whisper:

https://github.com/openai/whisper
