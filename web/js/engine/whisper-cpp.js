/**
 * Offline whisper.cpp engine.
 * Loads /vendor/whisper/main.js + main.wasm and streams segments while busy.
 */

import { MAX_AUDIO_SAMPLES, TARGET_SAMPLE_RATE } from './types.js';
import { parseWhisperOutput } from './whisper-parse.js';

export { parseWhisperOutput } from './whisper-parse.js';

const WASM_DIR = '/vendor/whisper/';
const WASM_SCRIPT = `${WASM_DIR}main.js`;
const MODEL_VFS_NAME = 'whisper.bin';
const SEG_RE = /^\[(\d{2}):(\d{2}):(\d{2}\.\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}\.\d{3})\]\s*(.*)$/;

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
      reject(new Error('This tab needs a refresh to enable local voice processing.'));
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
      print(text) {
        handlePrint(String(text));
      },
      printErr(text) {
        const line = String(text);
        if (line && !line.startsWith('worker')) {
          handlePrint(line);
        }
      },
      setStatus() {},
      monitorRunDependencies() {},
      onRuntimeInitialized() {
        sharedMod = mod;
        resolve(mod);
      },
    };
    /** @type {any} */ (window).Module = mod;

    const script = document.createElement('script');
    script.src = `${WASM_SCRIPT}?v=stream-wasm`;
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

/**
 * @param {string} line
 */
function handlePrint(line) {
  const m = SEG_RE.exec(line);
  if (!m) {
    return;
  }
  const start = hmsToSec(m[1], m[2], m[3]);
  const end = hmsToSec(m[4], m[5], m[6]);
  const text = (m[7] || '').trim();
  if (!text) {
    return;
  }
  liveChunks.push({ text, timestamp: [start, end] });
  if (partialHandler) {
    const joined = liveChunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
    partialHandler({ text: joined, chunks: liveChunks.slice() });
  }
}

/**
 * @param {string} hh
 * @param {string} mm
 * @param {string} ss
 */
function hmsToSec(hh, mm, ss) {
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

/**
 * @returns {import('./types.js').Engine}
 */
export function createWhisperCppEngine() {
  return {
    id: 'whisper-cpp',

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
      partialHandler = opts.onPartial || null;
      opts.onProgress?.({ status: 'transcribing', progress: 0.08 });

      const threads = clampThreads(opts.threads);
      const lang = opts.language || 'en';
      const rc = mod.full_default(sharedInstance, pcm, lang, threads, false);
      if (rc !== 0) {
        partialHandler = null;
        throw new Error('Could not process that audio.');
      }

      await waitUntilIdle(mod, estimatedTimeoutMs(pcm.length), () => {
        opts.onProgress?.({
          status: 'transcribing',
          progress: Math.min(0.92, 0.1 + liveChunks.length * 0.08),
        });
      });

      const withTs = opts.returnTimestamps !== false;
      let result;
      if (typeof mod.get_segment_count === 'function') {
        result = readSegments(mod, sharedInstance, true);
      } else {
        result = {
          text: liveChunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim(),
          chunks: liveChunks.slice(),
        };
      }

      if (opts.onPartial) {
        opts.onPartial(withTs ? result : { text: result.text });
      }
      partialHandler = null;
      opts.onProgress?.({ status: 'done', progress: 1 });
      return withTs ? result : { text: result.text };
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
 * @param {any} mod
 * @param {number} timeoutMs
 * @param {() => void} [onTick]
 */
function waitUntilIdle(mod, timeoutMs, onTick) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      onTick?.();
      let busy = true;
      try {
        busy = !!mod.is_busy();
      } catch {
        busy = false;
      }
      if (!busy) {
        // Let final prints flush.
        setTimeout(resolve, 30);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('That took too long. Try a shorter clip or Quick.'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
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
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const text = String(mod.get_segment_text(instance, i) || '').trim();
    if (!text) {
      continue;
    }
    const t0 = (mod.get_segment_t0(instance, i) | 0) / 100;
    const t1 = (mod.get_segment_t1(instance, i) | 0) / 100;
    chunks.push({ text, timestamp: [t0, t1] });
  }
  const text = chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
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
  try {
    mod.FS_unlink(MODEL_VFS_NAME);
  } catch {
    /* missing is fine */
  }
  mod.FS_createDataFile('/', MODEL_VFS_NAME, bytes, true, true);
}

/**
 * @param {string} path
 * @param {(ev: any) => void} [onProgress]
 * @returns {Promise<Uint8Array>}
 */
async function fetchModelBytes(path, onProgress) {
  const res = await fetch(path, { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error('Could not load the voice style.');
  }
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body || !total) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.({ status: 'fetching model', progress: 1, file: path });
    return buf;
  }

  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    out.set(value, offset);
    offset += value.length;
    onProgress?.({
      status: 'fetching model',
      progress: Math.min(0.9, offset / total),
      file: path,
    });
  }
  return out.subarray(0, offset);
}

/**
 * @param {number} [n]
 */
function clampThreads(n) {
  const want = typeof n === 'number' && n > 0 ? n : 2;
  let p = 1;
  while (p * 2 <= want && p * 2 <= 4) {
    p *= 2;
  }
  return p;
}

/**
 * @param {number} samples
 */
function estimatedTimeoutMs(samples) {
  const sec = samples / TARGET_SAMPLE_RATE;
  return Math.max(60000, Math.ceil(sec * 12000) + 20000);
}
