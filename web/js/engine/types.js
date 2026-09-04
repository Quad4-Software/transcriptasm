/**
 * Shared transcription types.
 */

/**
 * @typedef {object} ModelInfo
 * @property {string} id
 * @property {string} label
 * @property {string} engine
 * @property {string} path
 * @property {string} language
 * @property {number} size_hint_mb
 * @property {string} [notes]
 * @property {boolean} [default]
 * @property {boolean} [optional]
 * @property {boolean} [multilingual]
 * @property {number} [speed_rank]
 * @property {number} [accuracy_rank]
 * @property {string} [onnx_id]
 * @property {string} [onnx_path]
 */

/** @typedef {{ text: string, chunks?: Array<{ text: string, timestamp?: [number|null, number|null] }> }} TranscriptResult */

/** @typedef {{ status?: string, progress?: number, file?: string }} ProgressEvent */

/**
 * @typedef {object} TranscribeOptions
 * @property {string} [language]
 * @property {boolean} [returnTimestamps]
 * @property {boolean} [translate]
 * @property {number} [threads]
 * @property {(ev: ProgressEvent) => void} [onProgress]
 * @property {(partial: TranscriptResult) => void} [onPartial]
 */

/**
 * @typedef {object} Engine
 * @property {string} id
 * @property {() => string} [getBackend]
 * @property {(model: ModelInfo, onProgress?: (ev: ProgressEvent) => void) => Promise<void>} load
 * @property {(audio: Float32Array, opts?: TranscribeOptions) => Promise<TranscriptResult>} transcribe
 * @property {() => void} dispose
 */

export const TARGET_SAMPLE_RATE = 16000;
export const MAX_AUDIO_SAMPLES = TARGET_SAMPLE_RATE * 30 * 60;
