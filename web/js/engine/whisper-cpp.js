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
/** Seconds of audio per streaming window for progressive UI updates. */
const STREAM_WINDOW_SEC = 12;

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
      opts.onProgress?.({ status: 'transcribing', progress: 0.05 });

      const withTs = opts.returnTimestamps !== false;
      const threads = clampThreads(opts.threads);
      const lang = opts.language || 'en';

      // Process in windows so uploads stream segment-by-segment instead of one
      // final dump when whisper_full finishes the whole file.
      const windowSamples = Math.round(STREAM_WINDOW_SEC * TARGET_SAMPLE_RATE);
      const totalWindows = Math.max(1, Math.ceil(pcm.length / windowSamples));
      /** @type {Array<{ text: string, timestamp: [number, number] }>} */
      const collected = [];

      for (let w = 0; w < totalWindows; w++) {
        const start = w * windowSamples;
        const end = Math.min(pcm.length, start + windowSamples);
        const slice = pcm.subarray(start, end);
        if (slice.length < TARGET_SAMPLE_RATE / 4) {
          break;
        }
        const offsetSec = start / TARGET_SAMPLE_RATE;

        const rc = mod.full_default(sharedInstance, slice, lang, threads, false);
        if (rc !== 0) {
          partialHandler = null;
          throw new Error('Could not process that audio.');
        }

        await waitUntilIdle(mod, sharedInstance, estimatedTimeoutMs(slice.length), {
          onTick: () => {
            const base = (w + 0.15) / totalWindows;
            opts.onProgress?.({
              status: 'transcribing',
              progress: Math.min(0.92, 0.05 + base * 0.9),
            });
          },
          onSegments: () => {
            const partial = offsetSegments(readSegments(mod, sharedInstance, true), offsetSec);
            emitPartial(opts, withTs, mergeWindowSegments(collected, partial.chunks || []));
          },
        });

        const finalWin = offsetSegments(readSegments(mod, sharedInstance, true), offsetSec);
        mergeWindowSegments(collected, finalWin.chunks || []);
        emitPartial(opts, withTs, collected);
        opts.onProgress?.({
          status: 'transcribing',
          progress: Math.min(0.95, 0.05 + ((w + 1) / totalWindows) * 0.9),
        });
        await paintFrame();
      }

      liveChunks = collected.slice();
      const result = {
        text: collected.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim(),
        chunks: collected.slice(),
      };
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
 * @param {import('./types.js').TranscriptResult} result
 * @param {number} offsetSec
 * @returns {import('./types.js').TranscriptResult}
 */
function offsetSegments(result, offsetSec) {
  const chunks = (result.chunks || []).map((c) => {
    const t0 = c.timestamp && c.timestamp[0] != null ? Number(c.timestamp[0]) + offsetSec : offsetSec;
    const t1 = c.timestamp && c.timestamp[1] != null ? Number(c.timestamp[1]) + offsetSec : t0;
    return { text: c.text, timestamp: /** @type {[number, number]} */ ([t0, t1]) };
  });
  const text = chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
  return { text, chunks };
}

/**
 * Append new window segments into the running transcript list.
 * @param {Array<{ text: string, timestamp: [number, number] }>} collected
 * @param {Array<{ text: string, timestamp?: [number|null, number|null] }>} incoming
 */
function mergeWindowSegments(collected, incoming) {
  for (const c of incoming) {
    const text = (c.text || '').trim();
    if (!text) {
      continue;
    }
    const t0 = c.timestamp && c.timestamp[0] != null ? Number(c.timestamp[0]) : 0;
    const t1 = c.timestamp && c.timestamp[1] != null ? Number(c.timestamp[1]) : t0;
    const last = collected[collected.length - 1];
    if (last && last.text === text && Math.abs(last.timestamp[0] - t0) < 0.35) {
      last.timestamp[1] = Math.max(last.timestamp[1], t1);
      continue;
    }
    collected.push({ text, timestamp: [t0, t1] });
  }
  return collected;
}

/**
 * @param {import('./types.js').TranscribeOptions} opts
 * @param {boolean} withTs
 * @param {Array<{ text: string, timestamp: [number, number] }>} chunks
 */
function emitPartial(opts, withTs, chunks) {
  liveChunks = chunks.slice();
  if (!opts.onPartial) {
    return;
  }
  const text = chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
  opts.onPartial(withTs ? { text, chunks: chunks.slice() } : { text });
}

/**
 * Poll until the WASM worker finishes. Emit segments as get_segment_count grows
 * so the UI streams instead of waiting for printf flush at the end.
 * @param {any} mod
 * @param {number} instance
 * @param {number} timeoutMs
 * @param {{ onTick?: (segCount: number) => void, onSegments?: () => void }} [hooks]
 */
async function waitUntilIdle(mod, instance, timeoutMs, hooks = {}) {
  const start = Date.now();
  let lastCount = -1;

  const emitIfGrown = () => {
    let count = 0;
    try {
      count = typeof mod.get_segment_count === 'function' ? (mod.get_segment_count(instance) | 0) : 0;
    } catch {
      count = liveChunks.length;
    }
    hooks.onTick?.(Math.max(0, count));
    if (count > lastCount) {
      lastCount = count;
      if (count > 0) {
        hooks.onSegments?.();
      }
    }
    return count;
  };

  for (;;) {
    emitIfGrown();
    await paintFrame();

    let busy = true;
    try {
      busy = !!mod.is_busy();
    } catch {
      busy = false;
    }

    if (!busy) {
      await sleep(40);
      emitIfGrown();
      await paintFrame();
      return;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error('That took too long. Try a shorter clip or Quick.');
    }
    await sleep(60);
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
 * Yield so the browser can paint streamed transcript updates.
 */
function paintFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
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
  const data = ensurePlainBytes(bytes);
  try {
    mod.FS_unlink(MODEL_VFS_NAME);
  } catch {
    /* missing is fine */
  }
  mod.FS_createDataFile('/', MODEL_VFS_NAME, data, true, true);
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

  // Do not size the buffer from Content-Length. CDNs often gzip the payload while
  // fetch() yields the decompressed body, which is larger than Content-Length.
  const hinted = Number(res.headers.get('content-length') || 0);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.({ status: 'fetching model', progress: 1, file: path });
    return ensurePlainBytes(buf);
  }

  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value || value.length === 0) {
      continue;
    }
    chunks.push(value);
    received += value.length;
    const denom = hinted > 0 ? Math.max(hinted, received) : 0;
    onProgress?.({
      status: 'fetching model',
      progress: denom ? Math.min(0.95, received / denom) : Math.min(0.95, received / (received + 1)),
      file: path,
    });
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress?.({ status: 'fetching model', progress: 1, file: path });
  return ensurePlainBytes(out);
}

/**
 * Guarantee a tightly packed Uint8Array for Emscripten MEMFS writes.
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
