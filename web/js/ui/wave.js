/**
 * Ambient waveform canvas for the hero visual.
 */

/** @typedef {'idle' | 'recording' | 'transcribing'} WaveMode */

const PALETTE = {
  idle: {
    ink: 'rgba(236, 236, 240, 0.22)',
    accent: 'rgba(138, 208, 198, 0.45)',
    live: 'rgba(180, 240, 230, 0.95)',
    speed: 0.018,
  },
  recording: {
    ink: 'rgba(236, 200, 200, 0.2)',
    accent: 'rgba(226, 75, 75, 0.55)',
    live: 'rgba(255, 150, 150, 0.95)',
    speed: 0.032,
  },
  transcribing: {
    ink: 'rgba(236, 220, 190, 0.22)',
    accent: 'rgba(232, 184, 109, 0.58)',
    live: 'rgba(255, 220, 150, 0.95)',
    speed: 0.028,
  },
};

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createWaveController(canvas) {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let phase = 0;
  /** @type {Uint8Array | null} */
  let live = null;
  let reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** @type {WaveMode} */
  let mode = 'idle';

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || canvas.width;
    const height = Math.max(140, Math.round(width * 0.22));
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /**
   * @param {Uint8Array | null} data
   */
  function setLiveData(data) {
    live = data;
  }

  /**
   * @param {boolean} on
   */
  function setRecording(on) {
    mode = on ? 'recording' : mode === 'recording' ? 'idle' : mode;
  }

  /**
   * @param {WaveMode} next
   */
  function setMode(next) {
    mode = next === 'recording' || next === 'transcribing' ? next : 'idle';
  }

  function draw() {
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
    ctx.clearRect(0, 0, w, h);

    const mid = h * 0.55;
    const colors = PALETTE[mode] || PALETTE.idle;

    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    drawCurve(colors.ink, phase, 1, mid, w, h);
    drawCurve(colors.accent, phase * 1.35 + 1.2, 0.72, mid, w, h);

    if (live && live.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = colors.live;
      ctx.lineWidth = 2;
      const step = Math.max(1, Math.floor(live.length / w));
      for (let x = 0; x < w; x++) {
        const i = Math.min(live.length - 1, x * step);
        const v = (live[i] - 128) / 128;
        const y = mid + v * h * 0.35;
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    } else if (mode === 'transcribing') {
      drawBusyBars(colors.live, phase, mid, w, h);
    }

    if (!reduced) {
      phase += colors.speed;
      raf = requestAnimationFrame(draw);
    }
  }

  /**
   * Soft traveling bars while transcribing without mic input.
   * @param {string} color
   * @param {number} p
   * @param {number} mid
   * @param {number} w
   * @param {number} h
   */
  function drawBusyBars(color, p, mid, w, h) {
    const bars = Math.max(24, Math.floor(w / 18));
    const gap = w / bars;
    ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
      const t = i / bars;
      const amp =
        0.2 +
        0.55 * Math.abs(Math.sin(t * Math.PI * 3 + p * 1.8)) +
        0.25 * Math.abs(Math.sin(t * Math.PI * 7 + p));
      const bh = h * 0.18 * amp;
      const x = i * gap + gap * 0.25;
      const bw = Math.max(2, gap * 0.45);
      ctx.globalAlpha = 0.55 + amp * 0.35;
      ctx.fillRect(x, mid - bh, bw, bh * 2);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * @param {string} color
   * @param {number} p
   * @param {number} amp
   * @param {number} mid
   * @param {number} w
   * @param {number} h
   */
  function drawCurve(color, p, amp, mid, w, h) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    for (let x = 0; x <= w; x += 2) {
      const t = x / w;
      const y =
        mid +
        Math.sin(t * Math.PI * 4 + p) * 18 * amp +
        Math.sin(t * Math.PI * 9 + p * 0.7) * 8 * amp +
        Math.sin(t * Math.PI * 2.2 + p * 1.4) * 12 * amp;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  function start() {
    resize();
    cancelAnimationFrame(raf);
    draw();
  }

  function stop() {
    cancelAnimationFrame(raf);
  }

  window.addEventListener('resize', () => {
    resize();
    if (reduced) {
      draw();
    }
  });

  return { start, stop, setLiveData, setRecording, setMode };
}
