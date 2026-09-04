#!/usr/bin/env bash
# Optional helper to mirror ggml Whisper models for local serving experiments.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/web/vendor/models}"
MODEL="${2:-base.en-q5_1}"
SRC="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"

mkdir -p "$OUT"
DEST="$OUT/ggml-${MODEL}.bin"
if [[ -f "$DEST" ]]; then
  echo "already present: $DEST"
  exit 0
fi

echo "downloading $SRC"
curl -L --fail --retry 5 --retry-delay 2 -o "$DEST" "$SRC"
echo "saved $DEST"
