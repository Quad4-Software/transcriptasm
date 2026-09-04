#!/usr/bin/env bash
# Fetch offline whisper.cpp WASM + ggml models into web/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHISPER_DIR="$ROOT/web/vendor/whisper"
MODEL_DIR="$ROOT/web/models"
FONT_DIR="$ROOT/web/fonts"

mkdir -p "$WHISPER_DIR" "$MODEL_DIR" "$FONT_DIR"

download() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" && -s "$dest" ]]; then
    echo "present: $dest"
    return 0
  fi
  echo "fetching $url"
  curl -L --fail --retry 5 --retry-delay 2 -o "$dest" "$url"
}

download "https://ggml.ai/whisper.cpp/main.js" "$WHISPER_DIR/main.js"
download "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin" \
  "$MODEL_DIR/ggml-tiny.en-q5_1.bin"
download "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin" \
  "$MODEL_DIR/ggml-base.en-q5_1.bin"

download "https://cdn.jsdelivr.net/fontsource/fonts/bricolage-grotesque@5.2.8/latin-700-normal.woff2" \
  "$FONT_DIR/bricolage-700.woff2"
download "https://cdn.jsdelivr.net/fontsource/fonts/fraunces@5.2.8/latin-400-normal.woff2" \
  "$FONT_DIR/fraunces-400.woff2"
download "https://cdn.jsdelivr.net/fontsource/fonts/fraunces@5.2.8/latin-600-normal.woff2" \
  "$FONT_DIR/fraunces-600.woff2"

echo "offline assets ready"
