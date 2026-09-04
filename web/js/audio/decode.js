import { mixAudioBufferMono, resampleLinear } from './resample.js';
import { MAX_AUDIO_SAMPLES, TARGET_SAMPLE_RATE } from '../engine/types.js';

/**
 * Decode audio or video File/Blob to 16 kHz mono Float32Array.
 * Fast path: PCM WAV via a zero-dependency decoder.
 * Fallback: Web Audio for compressed audio/video containers.
 * @param {Blob} blob
 * @returns {Promise<Float32Array>}
 */
export async function decodeToWhisperPCM(blob) {
  if (!blob || blob.size === 0) {
    throw new Error('empty media blob');
  }
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);

  if (isRiffWave(bytes)) {
    try {
      return clampPCM(decodeWavPCM(bytes));
    } catch {
      // fall through to WebAudio
    }
  }

  return decodeViaWebAudio(ab);
}

/**
 * @param {ArrayBuffer} ab
 * @returns {Promise<Float32Array>}
 */
async function decodeViaWebAudio(ab) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) {
    throw new Error('Web Audio unavailable and media is not PCM WAV');
  }
  const ctx = new AC({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    const copy = ab.slice(0);
    const decoded = await ctx.decodeAudioData(copy);
    const mono = mixAudioBufferMono(decoded);
    const pcm =
      decoded.sampleRate === TARGET_SAMPLE_RATE
        ? mono
        : resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    return clampPCM(pcm);
  } finally {
    await ctx.close();
  }
}

/**
 * @param {Uint8Array} bytes
 */
function isRiffWave(bytes) {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

/**
 * Decode PCM / IEEE-float WAV to 16 kHz mono Float32Array.
 * @param {Uint8Array} data
 * @returns {Float32Array}
 */
export function decodeWavPCM(data) {
  if (data.length < 44) {
    throw new Error('wav too short');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  /** @type {Uint8Array | null} */
  let pcm = null;

  let offset = 12;
  while (offset + 8 <= data.length) {
    const id0 = data[offset];
    const id1 = data[offset + 1];
    const id2 = data[offset + 2];
    const id3 = data[offset + 3];
    const size = view.getUint32(offset + 4, true);
    offset += 8;
    if (size < 0 || offset + size > data.length) {
      throw new Error('invalid wav chunk');
    }
    if (id0 === 0x66 && id1 === 0x6d && id2 === 0x74 && id3 === 0x20) {
      audioFormat = view.getUint16(offset, true);
      channels = view.getUint16(offset + 2, true);
      sampleRate = view.getUint32(offset + 4, true);
      bits = view.getUint16(offset + 14, true);
    } else if (id0 === 0x64 && id1 === 0x61 && id2 === 0x74 && id3 === 0x61) {
      pcm = data.subarray(offset, offset + size);
    }
    offset += size + (size & 1);
  }

  if (!pcm || !channels || !sampleRate || !bits) {
    throw new Error('incomplete wav');
  }
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`unsupported wav format ${audioFormat}`);
  }

  const mono = decodePCMFrames(pcm, channels, bits, audioFormat);
  const out =
    sampleRate === TARGET_SAMPLE_RATE
      ? mono
      : resampleLinear(mono, sampleRate, TARGET_SAMPLE_RATE);
  return out;
}

/**
 * @param {Uint8Array} data
 * @param {number} channels
 * @param {number} bits
 * @param {number} format
 * @returns {Float32Array}
 */
function decodePCMFrames(data, channels, bits, format) {
  const bps = bits >>> 3;
  const frame = bps * channels;
  if (!frame || data.length % frame !== 0) {
    throw new Error('truncated pcm');
  }
  const frames = data.length / frame;
  const out = new Float32Array(frames);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const invCh = 1 / channels;

  if (format === 1 && channels === 1 && bits === 16) {
    for (let i = 0; i < frames; i++) {
      out[i] = view.getInt16(i * 2, true) * (1 / 32768);
    }
    return out;
  }

  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = i * frame;
    for (let c = 0; c < channels; c++) {
      const off = base + c * bps;
      sum += sampleAt(view, off, bits, format);
    }
    out[i] = sum * invCh;
  }
  return out;
}

/**
 * @param {DataView} view
 * @param {number} off
 * @param {number} bits
 * @param {number} format
 */
function sampleAt(view, off, bits, format) {
  if (format === 3 && bits === 32) {
    return view.getFloat32(off, true);
  }
  if (format === 1 && bits === 16) {
    return view.getInt16(off, true) / 32768;
  }
  if (format === 1 && bits === 8) {
    return (view.getUint8(off) - 128) / 128;
  }
  if (format === 1 && bits === 32) {
    return view.getInt32(off, true) / 2147483648;
  }
  return 0;
}

/**
 * @param {Float32Array} pcm
 * @returns {Float32Array}
 */
function clampPCM(pcm) {
  if (!pcm.length) {
    throw new Error('decoded media has no samples');
  }
  let out = pcm;
  if (out.length > MAX_AUDIO_SAMPLES) {
    out = out.subarray(0, MAX_AUDIO_SAMPLES);
  }
  return out.byteOffset === 0 && out.buffer.byteLength === out.byteLength
    ? out
    : out.slice();
}
