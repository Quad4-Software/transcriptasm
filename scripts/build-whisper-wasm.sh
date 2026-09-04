#!/usr/bin/env bash
# Build whisper.cpp to web/vendor/whisper/{main.js,main.wasm}
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/web/vendor/whisper"
WORKDIR="${TRANSCRIPTASM_WHISPER_SRC:-/tmp/whisper.cpp}"
EMSDK="${EMSDK:-/tmp/emsdk}"

if [[ -f "$EMSDK/emsdk_env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$EMSDK/emsdk_env.sh"
fi

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake not found. Install emsdk and source emsdk_env.sh first." >&2
  exit 1
fi

if [[ ! -d "$WORKDIR/.git" ]]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WORKDIR"
fi

# Prefer project-maintained binding if present.
BIND_SRC="$ROOT/third_party/whisper-wasm/emscripten.cpp"
if [[ -f "$BIND_SRC" ]]; then
  cp -f "$BIND_SRC" "$WORKDIR/examples/whisper.wasm/emscripten.cpp"
fi
CMAKE_SRC="$ROOT/third_party/whisper-wasm/CMakeLists.txt"
if [[ -f "$CMAKE_SRC" ]]; then
  cp -f "$CMAKE_SRC" "$WORKDIR/examples/whisper.wasm/CMakeLists.txt"
fi

BUILD="$WORKDIR/build-em"
mkdir -p "$BUILD" "$OUT"
cd "$BUILD"
emcmake cmake .. -DWHISPER_WASM_SINGLE_FILE=OFF -DGGML_NATIVE=OFF
cmake --build . --target libmain -j"$(nproc 2>/dev/null || echo 2)"

cp -f "$BUILD/bin/libmain.js" "$OUT/main.js"
cp -f "$BUILD/bin/libmain.wasm" "$OUT/main.wasm"
echo "installed:"
ls -lh "$OUT/main.js" "$OUT/main.wasm"
