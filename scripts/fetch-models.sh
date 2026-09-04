#!/usr/bin/env bash
# Fetch ggml Whisper models into web/models (not stored in git).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$ROOT/web/models"
mkdir -p "$MODEL_DIR"

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

download "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin" \
	"$MODEL_DIR/ggml-tiny.en-q5_1.bin"
download "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin" \
	"$MODEL_DIR/ggml-base.en-q5_1.bin"

echo "models ready"
