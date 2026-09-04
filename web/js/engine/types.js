/**
 * Shared transcription types.
 */

/** @typedef {{ id: string, label: string, engine: string, path: string, language: string, size_hint_mb: number, notes?: string, default?: boolean, optional?: boolean, multilingual?: boolean, speed_rank?: number, accuracy_rank?: number }} ModelInfo */

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
 * @property {(model: ModelInfo, onProgress?: (ev: ProgressEvent) => void) => Promise<void>} load
 * @property {(audio: Float32Array, opts?: TranscribeOptions) => Promise<TranscriptResult>} transcribe
 * @property {() => void} dispose
 */

export const TARGET_SAMPLE_RATE = 16000;
export const MAX_AUDIO_SAMPLES = TARGET_SAMPLE_RATE * 30 * 60;
