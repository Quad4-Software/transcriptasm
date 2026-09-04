/**
 * Offline whisper.cpp engine.
 * Loads /vendor/whisper/main.js + main.wasm and streams segments while busy.
 */

import { MAX_AUDIO_SAMPLES, TARGET_SAMPLE_RATE } from './types.js';
import { parseWhisperOutput } from './whisper-parse.js';
import {
  collapseRepeatLoops,
  joinChunkText,
} from './text-sanitize.js';

export { parseWhisperOutput } from './whisper-parse.js';
export { collapseRepeatLoops } from './text-sanitize.js';

const WASM_DIR = '/vendor/whisper/';
const WASM_SCRIPT = `${WASM_DIR}main.js`;
const MODEL_VFS_NAME = 'whisper.bin';
/** Minimum ms between UI partial flushes while still streaming. */
const PARTIAL_MIN_MS = 48;

/** @type {Promise<any> | null} */
let modulePromise = null;

/** @type {any} */
let sharedMod = null;
/** @type {number} */
let sharedInstance = 0;
/** @type {string} */
let sharedPath = '';

/** @type {Array<{ text: string, timestamp: [number, number] }>} */
let liveChunks = [];

/**
 * @returns {Promise<any>}
 */
function loadModule() {
  if (modulePromise) {
    return modulePromise;
  }
  modulePromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Needs a browser window.'));
      return;
    }
    if (!globalThis.crossOriginIsolated) {
      reject(new Error('This tab is not cross-origin isolated yet. Refresh once to enable local voice processing.'));
      return;
    }
    const existing = /** @type {any} */ (window).Module;
    if (existing && typeof existing.init === 'function' && typeof existing.is_busy === 'function') {
      sharedMod = existing;
      resolve(existing);
      return;
    }

    const mod = {
      locateFile(path) {
        const name = path.replace(/^.*\//, '');
        if (name.endsWith('.wasm')) {
          return `${WASM_DIR}main.wasm`;
        }
        return `${WASM_DIR}${name}`;
      },
      print() {},
      printErr() {},
      setStatus() {},
      monitorRunDependencies() {},
      onRuntimeInitialized() {
        sharedMod = mod;
        resolve(mod);
      },
    };
    /** @type {any} */ (window).Module = mod;

    const script = document.createElement('script');
    script.src = `${WASM_SCRIPT}?v=audio-ctx`;
    script.async = true;
    script.onerror = () => {
      modulePromise = null;
      reject(new Error('Could not load the voice engine.'));
    };
    document.head.appendChild(script);
  });
  return modulePromise;
}

/** @type {((partial: import('./types.js').TranscriptResult) => void) | null} */
let partialHandler = null;
let lastPartialAt = 0;

/**
 * @returns {import('./types.js').Engine}
 */
export function createWhisperCppEngine() {
  return {
    id: 'whisper-cpp',

    getBackend() {
      return 'WASM';
    },

    async load(model, onProgress) {
      onProgress?.({ status: 'loading wasm' });
      const mod = await loadModule();

      if (sharedPath === model.path && sharedInstance) {
        onProgress?.({ status: 'model cached', progress: 1 });
        return;
      }

      if (sharedInstance) {
        mod.free(sharedInstance);
        sharedInstance = 0;
        sharedPath = '';
      }

      onProgress?.({ status: 'fetching model', progress: 0, file: model.path });
      const bytes = await fetchModelBytes(model.path, onProgress);
      storeModel(mod, bytes);

      onProgress?.({ status: 'initializing model', progress: 0.95 });
      const instance = mod.init(MODEL_VFS_NAME);
      if (!instance) {
        throw new Error('Could not start the voice model. Try Quick, or free up memory.');
      }
      sharedInstance = instance;
      sharedPath = model.path;
      onProgress?.({ status: 'model ready', progress: 1 });
    },

    async transcribe(audio, opts = {}) {
      const mod = sharedMod;
      if (!mod || !sharedInstance) {
        throw new Error('Voice engine is not ready.');
      }
      if (!(audio instanceof Float32Array) || audio.length === 0) {
        throw new Error('No sound found.');
      }

      let pcm = audio;
      if (pcm.length > MAX_AUDIO_SAMPLES) {
        pcm = pcm.subarray(0, MAX_AUDIO_SAMPLES);
      }

      liveChunks = [];
      lastPartialAt = 0;
      partialHandler = opts.onPartial || null;
      opts.onProgress?.({ status: 'transcribing', progress: 0.05 });

      const withTs = opts.returnTimestamps !== false;
      const threads = clampThreads(opts.threads);
      const lang = opts.language || 'en';
      const translate = !!opts.translate;

      // One full pass is much faster than re-encoding many short windows.
      const rc = mod.full_default(sharedInstance, pcm, lang, threads, translate);
      if (rc !== 0) {
        partialHandler = null;
        throw new Error('Could not process that audio.');
      }

      await waitUntilIdle(mod, sharedInstance, estimatedTimeoutMs(pcm.length), {
        onTick: (segCount) => {
          opts.onProgress?.({
            status: 'transcribing',
            progress: Math.min(0.92, 0.08 + segCount * 0.07),
          });
          if (segCount > 0 && typeof mod.get_segment_count === 'function') {
            const partial = readSegments(mod, sharedInstance, true);
            liveChunks = toLiveChunks(partial.chunks);
            flushPartial(false);
          }
        },
      });

      const result = typeof mod.get_segment_count === 'function'
        ? readSegments(mod, sharedInstance, withTs)
        : { text: '' };
      liveChunks = withTs && result.chunks ? toLiveChunks(result.chunks) : [];
      flushPartial(true);
      partialHandler = null;
      opts.onProgress?.({ status: 'done', progress: 1 });
      return result;
    },

    dispose() {
      partialHandler = null;
      if (sharedMod && sharedInstance) {
        try {
          sharedMod.free(sharedInstance);
        } catch {
          /* ignore */
        }
      }
      sharedInstance = 0;
      sharedPath = '';
    },
  };
}

/**
 * @param {Array<{ text: string, timestamp?: [number|null, number|null] }> | undefined} chunks
 * @returns {Array<{ text: string, timestamp: [number, number] }>}
 */
function toLiveChunks(chunks) {
  if (!chunks || chunks.length === 0) {
    return [];
  }
  /** @type {Array<{ text: string, timestamp: [number, number] }>} */
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const text = (c.text || '').trim();
    if (!text) {
      continue;
    }
    const t0 = c.timestamp && c.timestamp[0] != null ? Number(c.timestamp[0]) : 0;
    const t1 = c.timestamp && c.timestamp[1] != null ? Number(c.timestamp[1]) : t0;
    out.push({ text, timestamp: [t0, t1] });
  }
  return out;
}

/**
 * @param {boolean} force
 */
function flushPartial(force) {
  if (!partialHandler) {
    return;
  }
  const now = performance.now();
  if (!force && now - lastPartialAt < PARTIAL_MIN_MS) {
    return;
  }
  lastPartialAt = now;
  const text = joinChunkText(liveChunks);
  partialHandler({ text, chunks: liveChunks });
}

/**
 * Poll until the WASM worker finishes.
 * @param {any} mod
 * @param {number} instance
 * @param {number} timeoutMs
 * @param {{ onTick?: (segCount: number) => void }} [hooks]
 */
async function waitUntilIdle(mod, instance, timeoutMs, hooks = {}) {
  const start = Date.now();
  let lastCount = -1;

  for (;;) {
    let count = liveChunks.length;
    try {
      if (typeof mod.get_segment_count === 'function') {
        count = mod.get_segment_count(instance) | 0;
      }
    } catch {
      /* keep liveChunks length */
    }
    if (count !== lastCount) {
      lastCount = count;
      hooks.onTick?.(count);
    }

    let busy = true;
    try {
      busy = !!mod.is_busy();
    } catch {
      busy = false;
    }

    if (!busy) {
      await sleep(8);
      return;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error('That took too long. Try a shorter clip or Quick.');
    }
    await sleep(24);
  }
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {any} mod
 * @param {number} instance
 * @param {boolean} withTimestamps
 * @returns {import('./types.js').TranscriptResult}
 */
function readSegments(mod, instance, withTimestamps) {
  const n = mod.get_segment_count(instance) | 0;
  /** @type {Array<{ text: string, timestamp?: [number, number] }>} */
  const chunks = new Array(n);
  let used = 0;
  for (let i = 0; i < n; i++) {
    const text = collapseRepeatLoops(String(mod.get_segment_text(instance, i) || '').trim());
    if (!text) {
      continue;
    }
    const t0 = (mod.get_segment_t0(instance, i) | 0) / 100;
    const t1 = (mod.get_segment_t1(instance, i) | 0) / 100;
    chunks[used++] = { text, timestamp: [t0, t1] };
  }
  chunks.length = used;
  const text = joinChunkText(chunks);
  if (!withTimestamps) {
    return { text };
  }
  return { text, chunks };
}

/**
 * @param {any} mod
 * @param {Uint8Array} bytes
 */
function storeModel(mod, bytes) {
  const data = ensurePlainBytes(bytes);
  try {
    mod.FS_unlink(MODEL_VFS_NAME);
  } catch {
    /* missing is fine */
  }
  mod.FS_createDataFile('/', MODEL_VFS_NAME, data, true, true, true);
}

/**
 * @param {string} path
 * @param {(ev: any) => void} [onProgress]
 * @returns {Promise<Uint8Array>}
 */
async function fetchModelBytes(path, onProgress) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error('Could not load the voice style.');
  }

  const hinted = Number(res.headers.get('content-length') || 0);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.({ status: 'fetching model', progress: 1, file: path });
    return ensurePlainBytes(buf);
  }

  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value || value.length === 0) {
      continue;
    }
    parts.push(value);
    received += value.length;
    const denom = hinted > 0 ? Math.max(hinted, received) : 0;
    onProgress?.({
      status: 'fetching model',
      progress: denom ? Math.min(0.95, received / denom) : 0.5,
      file: path,
    });
  }

  if (parts.length === 1) {
    onProgress?.({ status: 'fetching model', progress: 1, file: path });
    return ensurePlainBytes(parts[0]);
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], offset);
    offset += parts[i].length;
  }
  onProgress?.({ status: 'fetching model', progress: 1, file: path });
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function ensurePlainBytes(bytes) {
  if (bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.byteLength) {
    return bytes;
  }
  return bytes.slice();
}

/**
 * Use as many WASM pthread workers as the browser can spare (max 8).
 * @param {number} [n]
 */
function clampThreads(n) {
  const hw = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
  const want = typeof n === 'number' && n > 0 ? n : hw;
  const capped = Math.min(8, Math.max(1, want | 0));
  let p = 1;
  while (p * 2 <= capped) {
    p *= 2;
  }
  return p;
}

/**
 * @param {number} samples
 */
function estimatedTimeoutMs(samples) {
  const sec = samples / TARGET_SAMPLE_RATE;
  return Math.max(45000, Math.ceil(sec * 8000) + 15000);
}
