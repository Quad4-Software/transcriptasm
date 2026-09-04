/**
 * Whisper engine backed by transformers.js on WebGPU.
 */

import { MAX_AUDIO_SAMPLES } from './types.js';
import { sanitizeTranscriptChunks } from './text-sanitize.js';

/**
 * @returns {Promise<boolean>}
 */
export async function probeWebGPU() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * @returns {import('./types.js').Engine}
 */
export function createWhisperWebGPUEngine() {
  /** @type {Worker | null} */
  let worker = null;
  let seq = 1;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, onProgress?: Function }>} */
  const pending = new Map();
  /** @type {string} */
  let loadedOnnxId = '';

  function ensureWorker() {
    if (worker) {
      return worker;
    }
    worker = new Worker('/js/engine/whisper-webgpu-worker.js', { type: 'module' });
    worker.onmessage = (ev) => {
      const msg = ev.data || {};
      const slot = pending.get(msg.id);
      if (!slot) {
        return;
      }
      if (msg.type === 'progress') {
        slot.onProgress?.({
          status: msg.status,
          progress: msg.progress,
          file: msg.file,
        });
        return;
      }
      pending.delete(msg.id);
      if (msg.type === 'error') {
        slot.reject(new Error(msg.message || 'WebGPU transcription failed.'));
        return;
      }
      slot.resolve(msg);
    };
    worker.onerror = (ev) => {
      const err = new Error(ev.message || 'WebGPU worker failed.');
      for (const [, slot] of pending) {
        slot.reject(err);
      }
      pending.clear();
      worker = null;
      loadedOnnxId = '';
    };
    return worker;
  }

  /**
   * @param {string} type
   * @param {Record<string, any>} payload
   * @param {(ev: any) => void} [onProgress]
   * @param {Transferable[]} [transfer]
   */
  function call(type, payload, onProgress, transfer = []) {
    const id = seq++;
    const w = ensureWorker();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ id, type, ...payload }, transfer);
    });
  }

  return {
    id: 'whisper-webgpu',

    getBackend() {
      return 'WebGPU';
    },

    async load(model, onProgress) {
      const onnxId = model.onnx_id;
      if (!onnxId) {
        throw new Error('This model has no WebGPU build.');
      }
      if (loadedOnnxId === onnxId) {
        onProgress?.({ status: 'model cached', progress: 1 });
        return;
      }
      onProgress?.({ status: 'loading webgpu', progress: 0.02 });
      await call('load', { onnxId }, onProgress);
      loadedOnnxId = onnxId;
      onProgress?.({ status: 'model ready', progress: 1 });
    },

    async transcribe(audio, opts = {}) {
      if (!loadedOnnxId) {
        throw new Error('Voice engine is not ready.');
      }
      if (!(audio instanceof Float32Array) || audio.length === 0) {
        throw new Error('No sound found.');
      }
      let pcm = audio;
      if (pcm.length > MAX_AUDIO_SAMPLES) {
        pcm = pcm.subarray(0, MAX_AUDIO_SAMPLES);
      }
      // Copy so the worker can own the buffer without aliasing UI state.
      const copy = pcm.slice();
      opts.onProgress?.({ status: 'transcribing', progress: 0.05 });
      const msg = await call(
        'transcribe',
        {
          pcm: copy,
          language: opts.language || 'en',
          returnTimestamps: opts.returnTimestamps !== false,
          translate: !!opts.translate,
        },
        opts.onProgress,
        [copy.buffer],
      );
      const withTs = opts.returnTimestamps !== false;
      const result = sanitizeTranscriptChunks(msg.result?.chunks || [{ text: msg.result?.text || '' }], withTs);
      if (withTs && result.chunks) {
        opts.onPartial?.(result);
      }
      opts.onProgress?.({ status: 'done', progress: 1 });
      return result;
    },

    dispose() {
      loadedOnnxId = '';
      if (!worker) {
        return;
      }
      try {
        worker.postMessage({ id: seq++, type: 'dispose' });
      } catch {
        /* ignore */
      }
      worker.terminate();
      worker = null;
      pending.clear();
    },
  };
}
