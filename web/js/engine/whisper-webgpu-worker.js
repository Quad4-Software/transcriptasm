/**
 * Web Worker that runs transformers.js Whisper on WebGPU.
 */

import { pipeline, env } from '/vendor/transformers/transformers.min.js';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = true;
env.localModelPath = '/models/onnx/';
env.backends.onnx.wasm.wasmPaths = '/vendor/transformers/';

/** @type {any} */
let transcriber = null;
/** @type {string} */
let loadedId = '';

/**
 * @param {any} data
 */
function post(data) {
  self.postMessage(data);
}

/**
 * @param {any} raw
 * @returns {{ text: string, chunks: Array<{ text: string, timestamp: [number, number] }> }}
 */
function toChunks(raw) {
  if (!raw) {
    return { text: '', chunks: [] };
  }
  if (typeof raw === 'string') {
    return { text: raw, chunks: [{ text: raw, timestamp: [0, 0] }] };
  }
  const text = String(raw.text || '').trim();
  const chunks = [];
  const list = Array.isArray(raw.chunks) ? raw.chunks : [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const t = String(c.text || '').trim();
    if (!t) {
      continue;
    }
    const ts = Array.isArray(c.timestamp) ? c.timestamp : [0, 0];
    const t0 = ts[0] != null ? Number(ts[0]) : 0;
    const t1 = ts[1] != null ? Number(ts[1]) : t0;
    chunks.push({
      text: t,
      timestamp: [Number.isFinite(t0) ? t0 : 0, Number.isFinite(t1) ? t1 : 0],
    });
  }
  if (chunks.length === 0 && text) {
    chunks.push({ text, timestamp: [0, 0] });
  }
  return { text: text || chunks.map((c) => c.text).join(' '), chunks };
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    if (msg.type === 'load') {
      const onnxId = String(msg.onnxId || '');
      if (!onnxId) {
        throw new Error('Missing ONNX model id.');
      }
      if (transcriber && loadedId === onnxId) {
        post({ id, type: 'loaded', onnxId });
        return;
      }
      post({ id, type: 'progress', status: 'loading webgpu model', progress: 0.05 });
      transcriber = await pipeline('automatic-speech-recognition', onnxId, {
        device: 'webgpu',
        dtype: {
          encoder_model: 'fp32',
          decoder_model_merged: 'q4',
        },
        progress_callback: (p) => {
          const status = p && p.status ? String(p.status) : 'loading';
          let progress;
          if (typeof p?.progress === 'number') {
            progress = Math.min(0.95, p.progress);
          } else if (status === 'done') {
            progress = 0.95;
          } else {
            return;
          }
          // Drop high-frequency byte progress spam from ORT fetches.
          if (status === 'progress' && progress < 0.95) {
            return;
          }
          post({
            id,
            type: 'progress',
            status,
            progress,
            file: p?.file,
          });
        },
      });
      loadedId = onnxId;
      post({ id, type: 'loaded', onnxId });
      return;
    }

    if (msg.type === 'transcribe') {
      if (!transcriber) {
        throw new Error('WebGPU model is not ready.');
      }
      const pcm = msg.pcm;
      if (!(pcm instanceof Float32Array) || pcm.length === 0) {
        throw new Error('No sound found.');
      }
      post({ id, type: 'progress', status: 'transcribing', progress: 0.1 });
      const lang = msg.language && msg.language !== 'auto' ? msg.language : null;
      const opts = {
        return_timestamps: msg.returnTimestamps === false ? false : 'chunk',
        chunk_length_s: 30,
        stride_length_s: 5,
      };
      if (lang) {
        opts.language = lang;
      }
      if (msg.translate) {
        opts.task = 'translate';
      }
      const raw = await transcriber(pcm, opts);
      post({ id, type: 'progress', status: 'done', progress: 1 });
      post({ id, type: 'result', result: toChunks(raw) });
      return;
    }

    if (msg.type === 'dispose') {
      transcriber = null;
      loadedId = '';
      post({ id, type: 'disposed' });
      return;
    }

    throw new Error(`Unknown worker message: ${msg.type}`);
  } catch (err) {
    post({
      id,
      type: 'error',
      message: err && err.message ? String(err.message) : String(err),
    });
  }
};
