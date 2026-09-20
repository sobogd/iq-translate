# translator-ocr

Self-hosted OCR sidecar for the image-translation feature. Runs as its **own
PM2 process** (`translator-ocr`) next to the Next.js app and only listens on
`127.0.0.1` — nginx never routes public traffic to it.

Pipeline: **RapidOCR v3** (PP-OCRv5, ONNX Runtime CPU) → det + cls + rec.
Returns detected text lines with pixel geometry; the Node route
(`/api/translate-image`) sends only the recognized text to the local model for
translation and normalizes the boxes to 0..1.

## Resource limits (why this service can't hurt the other apps on the box)

Everything below is applied by default in `ecosystem-ocr.config.js` at the
repo root (deployed as `/home/deploy/apps/translator/ecosystem-ocr.config.js`):

| Limit | Value | How |
| --- | --- | --- |
| CPU | single inference at a time | uvicorn `--workers 1` + `OCR_CONCURRENCY=1` (single-worker `ThreadPoolExecutor`) |
| CPU threads | 2 | `OMP_NUM_THREADS` / `OPENBLAS_NUM_THREADS` / `MKL_NUM_THREADS = 2` in the PM2 env |
| RAM | restart at 1 GB | PM2 `max_memory_restart` |
| Crash loop | restart w/ backoff | PM2 `exp_backoff_restart_delay` |
| Max upload | 15 MB | `OCR_MAX_BYTES` |
| Max image side | 2000 px | `OCR_MAX_SIDE` (downscaled server-side, boxes stay normalized) |
| Concurrent HTTP | 4 | uvicorn `--limit-concurrency 4` |

If the box has spare cores, raise `OCR_CONCURRENCY`/thread envs — the point is
only that the cap is explicit, not that it must stay 1.

## Setup

Requires Python >= 3.10, < 3.13 (onnxruntime wheel availability). The deploy
workflow provisions the venv itself and tolerates boxes without `python3-venv`
(no `ensurepip`): it tries a plain `venv`, then `venv --without-pip` +
bootstrap pip, then a `pip install --user` fallback that the `ocr.sh` launcher
uses via the system `python3`.

```bash
cd services/ocr
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python warmup.py        # pre-downloads models (rec langs in OCR_REC_LANGS)
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8701 --workers 1
```

Local smoke test:

```bash
curl -s http://127.0.0.1:8701/healthz
curl -s -X POST --data-binary @/path/to/photo.jpg \
     -H 'Content-Type: image/jpeg' 'http://127.0.0.1:8701/ocr?rec_lang=latin'
```

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `OCR_HOST` / `OCR_PORT` | `127.0.0.1` / `8701` | bind address (never 0.0.0.0) |
| `OCR_REC_LANG` | `cyrillic` | default recognition model: `cyrillic` (ru/uk/... + en), `latin` (de/fr/es/... + en), `en` |
| `OCR_REC_LANGS` | `cyrillic,latin` | allowed languages; each used one is a lazily-built engine (more = more RAM) |
| `OCR_PRELOAD` | `0` | build engines at startup (deploy warmup covers this) |
| `OCR_CONCURRENCY` | `1` | parallel OCR inferences inside the process |
| `OCR_MAX_SIDE` | `2000` | downscale cap for the longest edge |
| `OCR_MIN_SCORE` | `0.5` | per-line confidence filter |
| `OCR_MAX_BYTES` | `15728640` | request body cap |

## HTTP contract

`POST /ocr` — raw image bytes (JPEG/PNG/WebP), optional `?rec_lang=`:

```jsonc
{
  "width": 2000, "height": 1500,          // processed image the boxes refer to
  "rec_lang": "latin",
  "elapse_s": 0.41,
  "blocks": [{
    "text": "Exit",
    "confidence": 0.99,
    "polygon": [[12, 30], [320, 30], [320, 90], [12, 90]],  // px, 4 pts
    "box":     [12, 30, 320, 90]                            // x0 y0 x1 y1 px
  }]
}
```

Errors: `413 image_too_large`, `415 unsupported image`, `400 empty body`,
`400 unsupported rec_lang`, `500 ocr_error`.

`POST /compose` — JSON body, returns the translated image as `image/jpeg`:

```jsonc
{
  "image": "<base64 of the ORIGINAL upload>",
  "width": 2000, "height": 1500,          // processed dims from /ocr
  "blocks": [{ "polygon": [[0.1,0.2], ...], "translation": "Выход" }] // normalized 0..1
}
```

Repaints each block: erases the area with the median colour of its
surrounding ring and draws the translation auto-fitted (wrap + shrink) in
black/white for contrast. Not an inpainter — flat backgrounds are clean,
complex photo textures may leave traces. Requires a font covering the target
script: set `TRANSLATED_FONT` to a TTF path, otherwise DejaVu Sans is tried
(Latin + Cyrillic). Tune JPEG quality with `COMPOSE_QUALITY` (default 88).
Errors: `413 payload_too_large`, `400 bad json|image|payload`, `500 compose_error`.

`GET /healthz` — liveness + loaded engines.

## Known limits

* One recognition language per request; a photo mixing Cyrillic + Latin +
  e.g. CJK will miss scripts outside the engine's model. Detection (det) is
  multilingual, so boxes are still found; only recognition fails. For such
  images run a second OCR pass with the matching `rec_lang`.
* Axis boxes (`box`) are axis-aligned bounds of the polygon — use `polygon`
  when the text line is rotated.
