#!/usr/bin/env bash
# Fetch ONNX Whisper assets for WebGPU (hybrid fp32 encoder + q4 decoder).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ONNX_OUT:-$ROOT/web/models/onnx}"
HF="https://huggingface.co/onnx-community"

download() {
	local url="$1"
	local dest="$2"
	if [[ -f "$dest" && -s "$dest" ]]; then
		echo "present: $dest"
		return 0
	fi
	mkdir -p "$(dirname "$dest")"
	echo "fetching $url"
	curl -L --fail --retry 5 --retry-delay 2 -o "$dest" "$url"
}

try_download() {
	local url="$1"
	local dest="$2"
	if [[ -f "$dest" && -s "$dest" ]]; then
		echo "present: $dest"
		return 0
	fi
	mkdir -p "$(dirname "$dest")"
	if curl -L --fail --retry 2 --retry-delay 1 -o "$dest" "$url"; then
		echo "fetched: $dest"
		return 0
	fi
	rm -f "$dest"
	echo "skip optional: $dest"
	return 0
}

fetch_model() {
	local id="$1"
	local dir="$OUT/$id"
	local base="$HF/$id/resolve/main"
	mkdir -p "$dir/onnx"

	download "$base/config.json" "$dir/config.json"
	download "$base/tokenizer.json" "$dir/tokenizer.json"
	download "$base/tokenizer_config.json" "$dir/tokenizer_config.json"
	download "$base/preprocessor_config.json" "$dir/preprocessor_config.json"
	download "$base/onnx/encoder_model.onnx" "$dir/onnx/encoder_model.onnx"
	download "$base/onnx/decoder_model_merged_q4.onnx" "$dir/onnx/decoder_model_merged_q4.onnx"

	try_download "$base/generation_config.json" "$dir/generation_config.json"
	try_download "$base/special_tokens_map.json" "$dir/special_tokens_map.json"
	try_download "$base/added_tokens.json" "$dir/added_tokens.json"
	try_download "$base/normalizer.json" "$dir/normalizer.json"
	try_download "$base/merges.txt" "$dir/merges.txt"
	try_download "$base/vocab.json" "$dir/vocab.json"
	try_download "$base/quantize_config.json" "$dir/quantize_config.json"
}

fetch_model "whisper-tiny.en"
fetch_model "whisper-base.en"
fetch_model "whisper-small.en"
fetch_model "whisper-tiny"
fetch_model "whisper-base"

echo "onnx models ready"
