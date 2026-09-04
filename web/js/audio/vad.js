/**
 * Energy / RMS voice-activity detector for 16 kHz mono PCM.
 */

/**
 * @typedef {object} EnergyVadOptions
 * @property {(pcm: Float32Array, t0: number, t1: number) => void} onSpeechEnd
 * @property {number} [sampleRate]
 * @property {number} [threshold]
 * @property {number} [hangoverMs]
 * @property {number} [minSpeechMs]
 * @property {number} [maxChunkMs]
 */

/**
 * @param {EnergyVadOptions} opts
 */
export function createEnergyVad(opts) {
  const sampleRate = opts.sampleRate || 16000;
  const threshold = opts.threshold ?? 0.015;
  const hangoverSamples = Math.max(1, Math.round(((opts.hangoverMs ?? 500) / 1000) * sampleRate));
  const minSpeechSamples = Math.max(1, Math.round(((opts.minSpeechMs ?? 300) / 1000) * sampleRate));
  const maxChunkSamples = Math.max(minSpeechSamples, Math.round(((opts.maxChunkMs ?? 12000) / 1000) * sampleRate));

  /** @type {number[]} */
  let buf = [];
  let inSpeech = false;
  let silenceRun = 0;
  let absoluteOffset = 0;
  let speechStartAbs = 0;

  /**
   * @param {Float32Array} frame
   */
  function push(frame) {
    if (!frame || frame.length === 0) {
      return;
    }
    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i];
      const energy = sample * sample;
      const voiced = Math.sqrt(energy) >= threshold;

      if (!inSpeech) {
        if (voiced) {
          inSpeech = true;
          silenceRun = 0;
          speechStartAbs = absoluteOffset + i;
          buf = [sample];
        }
        continue;
      }

      buf.push(sample);
      if (voiced) {
        silenceRun = 0;
      } else {
        silenceRun += 1;
      }

      const speechLen = buf.length;
      if (silenceRun >= hangoverSamples && speechLen - hangoverSamples >= minSpeechSamples) {
        emitTrimmed();
        continue;
      }
      if (speechLen >= maxChunkSamples) {
        emitAll();
      }
    }
    absoluteOffset += frame.length;
  }

  function flush() {
    if (inSpeech && buf.length >= minSpeechSamples) {
      emitAll();
    }
    resetSpeech();
  }

  function emitTrimmed() {
    const keep = Math.max(0, buf.length - silenceRun);
    if (keep < minSpeechSamples) {
      resetSpeech();
      return;
    }
    const pcm = Float32Array.from(buf.slice(0, keep));
    const t0 = speechStartAbs / sampleRate;
    const t1 = (speechStartAbs + keep) / sampleRate;
    resetSpeech();
    opts.onSpeechEnd(pcm, t0, t1);
  }

  function emitAll() {
    if (buf.length < minSpeechSamples) {
      resetSpeech();
      return;
    }
    const pcm = Float32Array.from(buf);
    const t0 = speechStartAbs / sampleRate;
    const t1 = (speechStartAbs + buf.length) / sampleRate;
    resetSpeech();
    opts.onSpeechEnd(pcm, t0, t1);
  }

  function resetSpeech() {
    inSpeech = false;
    silenceRun = 0;
    buf = [];
  }

  return { push, flush };
}
