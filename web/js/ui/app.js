import { createEngine, registerEngine } from '../engine/registry.js';
import { createWhisperCppEngine } from '../engine/whisper-cpp.js';
import { decodeToWhisperPCM } from '../audio/decode.js';
import { MicRecorder } from '../audio/mic.js';
import { createWaveController } from './wave.js';

registerEngine('whisper-cpp', createWhisperCppEngine);

/**
 * Wire the page UI.
 */
export async function bootApp() {
  const els = {
    model: /** @type {HTMLSelectElement} */ (document.getElementById('model')),
    timestamps: /** @type {HTMLInputElement} */ (document.getElementById('timestamps')),
    btnMic: /** @type {HTMLButtonElement} */ (document.getElementById('btn-mic')),
    btnCopy: /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy')),
    btnDownload: /** @type {HTMLButtonElement} */ (document.getElementById('btn-download')),
    btnClear: /** @type {HTMLButtonElement} */ (document.getElementById('btn-clear')),
    file: /** @type {HTMLInputElement} */ (document.getElementById('file')),
    status: /** @type {HTMLElement} */ (document.getElementById('status')),
    spinner: /** @type {HTMLElement} */ (document.getElementById('spinner')),
    livePill: /** @type {HTMLElement} */ (document.getElementById('live-pill')),
    progress: /** @type {HTMLElement} */ (document.getElementById('progress')),
    progressTrack: /** @type {HTMLElement} */ (document.querySelector('.progress-track')),
    error: /** @type {HTMLElement} */ (document.getElementById('error')),
    transcript: /** @type {HTMLElement} */ (document.getElementById('transcript')),
    meta: /** @type {HTMLElement} */ (document.getElementById('meta')),
    wave: /** @type {HTMLCanvasElement} */ (document.getElementById('wave')),
    recLabel: /** @type {HTMLElement} */ (document.querySelector('.rec-label')),
    recTimer: /** @type {HTMLElement} */ (document.getElementById('rec-timer')),
  };

  const wave = createWaveController(els.wave);
  wave.start();

  /** @type {import('../engine/types.js').ModelInfo[]} */
  let models = [];
  /** @type {import('../engine/types.js').Engine | null} */
  let engine = null;
  /** @type {string} */
  let loadedModelId = '';
  /** @type {MicRecorder | null} */
  let mic = null;
  let busy = false;
  let recording = false;
  let micWatch = 0;
  let timerWatch = 0;
  let recordStartedAt = 0;
  /** @type {Promise<void> | null} */
  let warmup = null;
  /** @type {import('../engine/types.js').TranscriptResult | null} */
  let lastResult = null;

  setBusy(true, 'Getting ready...');
  try {
    models = await loadModels();
    fillModels(els.model, models);
    clearError();
    setStatus('Warming up...');
    warmup = ensureModel()
      .then(() => {
        setBusy(false, 'Ready when you are.');
        els.status.classList.add('is-ok');
      })
      .catch((err) => {
        setBusy(false, 'Could not finish setup.');
        showError(friendlyError(err));
      });
  } catch (err) {
    setBusy(false, 'Something went wrong.');
    showError(friendlyError(err));
  }

  els.btnMic.addEventListener('click', () => {
    if (recording) {
      void stopMic();
    } else {
      void startMic();
    }
  });
  els.file.addEventListener('change', () => void onFile());
  els.btnCopy.addEventListener('click', () => void copyTranscript());
  els.btnDownload.addEventListener('click', () => downloadTranscript());
  els.btnClear.addEventListener('click', () => clearTranscript());
  els.model.addEventListener('change', () => {
    loadedModelId = '';
    clearError();
    setBusy(true, 'Switching voice style...');
    warmup = ensureModel()
      .then(() => {
        setBusy(false, 'Ready when you are.');
        els.status.classList.add('is-ok');
      })
      .catch((err) => {
        setBusy(false, 'Could not load that style.');
        showError(friendlyError(err));
      });
  });
  els.timestamps.addEventListener('change', () => {
    if (lastResult) {
      renderTranscript(lastResult, els.timestamps.checked);
    }
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.code !== 'Space' || ev.repeat) {
      return;
    }
    const tag = (ev.target && /** @type {HTMLElement} */ (ev.target).tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
      return;
    }
    ev.preventDefault();
    if (recording) {
      void stopMic();
    } else if (!busy) {
      void startMic();
    }
  });

  /**
   * @returns {import('../engine/types.js').ModelInfo | null}
   */
  function selectedModel() {
    return models.find((m) => m.id === els.model.value) || null;
  }

  async function ensureModel() {
    const model = selectedModel();
    if (!model) {
      throw new Error('Pick a voice style first.');
    }
    if (engine && loadedModelId === model.id) {
      return model;
    }
    if (engine) {
      engine.dispose();
      engine = null;
    }
    engine = createEngine(model.engine);
    setStatus(`Loading ${model.label}...`);
    showProgress(0);
    await engine.load(model, (p) => {
      if (typeof p.progress === 'number') {
        showProgress(Math.round(p.progress * 100));
      }
      if (p.status === 'fetching model') {
        setStatus(`Loading ${model.label}...`);
      } else if (p.status === 'initializing model' || p.status === 'loading wasm') {
        setStatus('Almost ready...');
      } else if (p.status === 'model ready' || p.status === 'model cached') {
        setStatus(`${model.label} is ready.`);
      }
    });
    loadedModelId = model.id;
    hideProgress();
    return model;
  }

  async function startMic() {
    if (busy || recording) {
      return;
    }
    clearError();
    els.status.classList.remove('is-ok');
    try {
      if (warmup) {
        await warmup;
      }
      recording = true;
      setRecordingUI(true);
      els.file.disabled = true;
      els.model.disabled = true;
      mic = new MicRecorder();
      await mic.start();
      setStatus('Listening... press Space or Stop when done');
      wave.setRecording(true);
      recordStartedAt = Date.now();
      els.recTimer.hidden = false;
      tickTimer();
      timerWatch = window.setInterval(tickTimer, 250);
      micWatch = window.setInterval(() => {
        wave.setLiveData(mic ? mic.getWaveform() : null);
      }, 40);
    } catch (err) {
      recording = false;
      setRecordingUI(false);
      setControls(false);
      wave.setRecording(false);
      setStatus('Could not reach the mic.');
      showError(friendlyError(err));
      cleanupMic();
    }
  }

  async function stopMic() {
    if (!mic || !recording) {
      return;
    }
    busy = true;
    els.btnMic.disabled = true;
    try {
      setStatus('Wrapping up...');
      setLoading(true);
      const pcm = await mic.stop();
      cleanupMic();
      recording = false;
      setRecordingUI(false);
      wave.setRecording(false);
      await runTranscription(pcm);
    } catch (err) {
      setStatus('That recording did not work.');
      showError(friendlyError(err));
    } finally {
      cleanupMic();
      recording = false;
      setRecordingUI(false);
      wave.setRecording(false);
      setControls(false);
      setLoading(false);
      setLive(false);
      busy = false;
    }
  }

  async function onFile() {
    const file = els.file.files && els.file.files[0];
    els.file.value = '';
    if (!file || busy || recording) {
      return;
    }
    if (!isAllowedMediaFile(file)) {
      showError('Choose an audio or video file.');
      setStatus('That file type is not supported.');
      return;
    }
    busy = true;
    clearError();
    els.status.classList.remove('is-ok');
    setControls(true);
    setLoading(true);
    try {
      if (warmup) {
        await warmup;
      }
      setStatus(`Opening ${file.name}...`);
      const pcm = await decodeToWhisperPCM(file);
      await runTranscription(pcm);
    } catch (err) {
      setStatus('Could not read that file.');
      showError(friendlyError(err));
    } finally {
      setControls(false);
      setLoading(false);
      setLive(false);
      busy = false;
    }
  }

  /**
   * @param {Float32Array} pcm
   */
  async function runTranscription(pcm) {
    if (!pcm || pcm.length === 0) {
      setStatus('No sound found.');
      showError('Try again with a clearer recording or another file.');
      return;
    }
    const model = await ensureModel();
    if (!engine) {
      throw new Error('Voice engine is not ready.');
    }
    const seconds = pcm.length / 16000;
    const t0 = performance.now();
    setStatus('Writing it down...');
    setLive(true);
    showProgress(8);
    els.transcript.classList.add('is-live');
    els.transcript.replaceChildren();

    const result = await engine.transcribe(pcm, {
      language: model.language,
      returnTimestamps: true,
      onProgress: (p) => {
        if (typeof p.progress === 'number') {
          showProgress(Math.max(8, Math.round(p.progress * 100)));
        }
      },
      onPartial: (partial) => {
        lastResult = partial;
        renderTranscript(partial, els.timestamps.checked);
        updateActions(true);
      },
    });

    lastResult = result;
    renderTranscript(result, els.timestamps.checked);
    els.transcript.classList.remove('is-live');
    setLive(false);
    hideProgress();
    const ms = Math.round(performance.now() - t0);
    const rtf = seconds > 0 ? (ms / 1000 / seconds) : 0;
    els.meta.hidden = false;
    els.meta.textContent = `${seconds.toFixed(1)}s audio in ${(ms / 1000).toFixed(1)}s (${rtf.toFixed(2)}x) using ${model.label}`;
    setStatus('Done. Still just on this device.');
    els.status.classList.add('is-ok');
    updateActions(!!(result.text || (result.chunks && result.chunks.length)));
  }

  function cleanupMic() {
    window.clearInterval(micWatch);
    window.clearInterval(timerWatch);
    wave.setLiveData(null);
    if (mic) {
      mic.cleanup();
      mic = null;
    }
    els.recTimer.hidden = true;
    els.recTimer.textContent = '0:00';
  }

  function tickTimer() {
    const sec = Math.max(0, Math.floor((Date.now() - recordStartedAt) / 1000));
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');
    els.recTimer.textContent = `${m}:${s}`;
  }

  /**
   * @param {boolean} on
   */
  function setRecordingUI(on) {
    els.btnMic.classList.toggle('is-recording', on);
    els.btnMic.setAttribute('aria-pressed', on ? 'true' : 'false');
    els.recLabel.textContent = on ? 'Stop' : 'Record';
    els.btnMic.disabled = false;
  }

  /**
   * @param {boolean} locked
   */
  function setControls(locked) {
    els.btnMic.disabled = locked;
    els.file.disabled = locked;
    els.model.disabled = locked;
    els.timestamps.disabled = locked;
  }

  /**
   * @param {boolean} on
   * @param {string} [msg]
   */
  function setBusy(on, msg) {
    busy = on;
    setControls(on);
    setLoading(on);
    if (msg) {
      setStatus(msg);
    }
  }

  /**
   * @param {boolean} on
   */
  function setLoading(on) {
    els.spinner.hidden = !on;
  }

  /**
   * @param {boolean} on
   */
  function setLive(on) {
    els.livePill.classList.toggle('is-on', on);
  }

  /**
   * @param {string} text
   */
  function setStatus(text) {
    els.status.textContent = text;
  }

  /**
   * @param {number} pct
   */
  function showProgress(pct) {
    els.progressTrack.hidden = false;
    els.progress.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function hideProgress() {
    els.progressTrack.hidden = true;
    els.progress.style.width = '0%';
  }

  /**
   * @param {string} msg
   */
  function showError(msg) {
    els.error.hidden = false;
    els.error.textContent = msg;
  }

  function clearError() {
    els.error.hidden = true;
    els.error.textContent = '';
  }

  /**
   * @param {boolean} hasText
   */
  function updateActions(hasText) {
    els.btnCopy.disabled = !hasText;
    els.btnDownload.disabled = !hasText;
    els.btnClear.disabled = !hasText;
  }

  /**
   * @param {import('../engine/types.js').TranscriptResult} result
   * @param {boolean} withTimestamps
   */
  function renderTranscript(result, withTimestamps) {
    if (withTimestamps && result.chunks && result.chunks.length) {
      els.transcript.replaceChildren();
      for (const c of result.chunks) {
        const row = document.createElement('span');
        row.className = 'seg';
        const ts = formatTimestamp(c.timestamp);
        if (ts) {
          const time = document.createElement('span');
          time.className = 'seg-time';
          time.textContent = ts;
          row.appendChild(time);
        }
        row.appendChild(document.createTextNode(c.text.trim()));
        els.transcript.appendChild(row);
      }
      return;
    }
    els.transcript.textContent = (result.text || '').trim();
  }

  function transcriptPlain() {
    return (els.transcript.innerText || els.transcript.textContent || '').trim();
  }

  async function copyTranscript() {
    const text = transcriptPlain();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied.');
      els.status.classList.add('is-ok');
    } catch {
      showError('Could not copy. Select the text and copy it yourself.');
    }
  }

  function downloadTranscript() {
    const text = transcriptPlain();
    if (!text) {
      return;
    }
    const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcriptasm-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Downloaded.');
    els.status.classList.add('is-ok');
  }

  function clearTranscript() {
    lastResult = null;
    els.transcript.replaceChildren();
    els.meta.hidden = true;
    els.meta.textContent = '';
    updateActions(false);
    setStatus('Cleared. Ready when you are.');
    els.status.classList.add('is-ok');
  }
}

/**
 * @param {HTMLSelectElement} select
 * @param {import('../engine/types.js').ModelInfo[]} models
 */
function fillModels(select, models) {
  select.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.default) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
}

/**
 * Prefer the Go API, fall back to static catalog for GitHub Pages.
 * @returns {Promise<import('../engine/types.js').ModelInfo[]>}
 */
async function loadModels() {
  const urls = ['/api/models', '/models.json'];
  let lastErr = /** @type {unknown} */ (null);
  for (const url of urls) {
    try {
      const catalog = await fetchJSON(url);
      const list = catalog && Array.isArray(catalog.models) ? catalog.models : [];
      if (list.length > 0) {
        return list;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Could not load voice styles.');
}

const MEDIA_EXTENSIONS = new Set([
  '.wav', '.wave', '.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac',
  '.webm', '.mp4', '.m4v', '.mkv', '.mov', '.avi', '.mpeg', '.mpg', '.3gp',
]);

/**
 * @param {File} file
 */
function isAllowedMediaFile(file) {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('audio/') || mime.startsWith('video/')) {
    return true;
  }
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }
  return MEDIA_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/**
 * @param {string} url
 */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Could not reach the app.');
  }
  return res.json();
}

/**
 * @param {unknown} err
 */
function friendlyError(err) {
  const msg = err && typeof err === 'object' && 'message' in err
    ? String(/** @type {{ message: string }} */ (err).message)
    : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('permission') || lower.includes('notallowed') || lower.includes('denied')) {
    return 'Microphone access was blocked. Allow it in your browser settings, then try again.';
  }
  if (lower.includes('decode') || lower.includes('wav') || lower.includes('media')) {
    return 'That file could not be read. Try a common audio or video format.';
  }
  if (lower.includes('refresh') || lower.includes('isolated') || lower.includes('cross-origin')) {
    return 'This browser tab needs a refresh to enable local voice processing.';
  }
  if (lower.includes('memory') || lower.includes('init') || lower.includes('start the voice')) {
    return 'This device ran out of room for the voice model. Close other tabs and retry with Quick.';
  }
  if (lower.includes('too long') || lower.includes('timed out')) {
    return 'That took too long. Try a shorter clip or the Quick voice style.';
  }
  return msg || 'Something unexpected happened.';
}

/**
 * @param {[number|null, number|null] | undefined} ts
 */
function formatTimestamp(ts) {
  if (!ts || ts[0] == null) {
    return '';
  }
  const start = formatTime(ts[0]);
  const end = ts[1] == null ? '' : formatTime(ts[1]);
  return end ? `${start}-${end}` : start;
}

/**
 * @param {number} sec
 */
function formatTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}
