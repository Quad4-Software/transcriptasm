/**
 * Auto engine: WebGPU first, whisper.cpp WASM fallback.
 */

import { createWhisperCppEngine } from './whisper-cpp.js';
import { createWhisperWebGPUEngine, probeWebGPU } from './whisper-webgpu.js';

/**
 * @returns {import('./types.js').Engine}
 */
export function createAutoEngine() {
  /** @type {import('./types.js').Engine | null} */
  let active = null;
  /** @type {'WebGPU' | 'WASM' | ''} */
  let backend = '';
  let forcedWasm = false;
  /** @type {import('./types.js').ModelInfo | null} */
  let lastModel = null;

  async function useWasm(model, onProgress, permanent = true) {
    if (active) {
      try {
        active.dispose();
      } catch {
        /* ignore */
      }
    }
    active = createWhisperCppEngine();
    backend = 'WASM';
    if (permanent) {
      forcedWasm = true;
    }
    onProgress?.({ status: 'loading wasm fallback', progress: 0.05 });
    await active.load(model, onProgress);
  }

  return {
    id: 'auto',

    getBackend() {
      if (active && typeof active.getBackend === 'function') {
        return active.getBackend();
      }
      return backend || 'WASM';
    },

    async load(model, onProgress) {
      lastModel = model;
      if (forcedWasm || !model.onnx_id) {
        await useWasm(model, onProgress, true);
        return;
      }

      const ok = await probeWebGPU();
      if (!ok) {
        await useWasm(model, onProgress, false);
        return;
      }

      try {
        if (active) {
          try {
            active.dispose();
          } catch {
            /* ignore */
          }
        }
        active = createWhisperWebGPUEngine();
        backend = 'WebGPU';
        onProgress?.({ status: 'loading webgpu', progress: 0.05 });
        await active.load(model, onProgress);
      } catch (err) {
        console.warn('WebGPU load failed, falling back to WASM', err);
        await useWasm(model, onProgress, true);
      }
    },

    async transcribe(audio, opts = {}) {
      if (!active) {
        throw new Error('Voice engine is not ready.');
      }
      try {
        return await active.transcribe(audio, opts);
      } catch (err) {
        if (backend === 'WebGPU' && lastModel) {
          console.warn('WebGPU transcribe failed, falling back to WASM', err);
          await useWasm(lastModel, opts.onProgress);
          return active.transcribe(audio, opts);
        }
        throw err;
      }
    },

    dispose() {
      if (active) {
        try {
          active.dispose();
        } catch {
          /* ignore */
        }
      }
      active = null;
      backend = '';
      lastModel = null;
    },
  };
}
