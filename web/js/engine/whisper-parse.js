const SEG_RE = /^\[(\d{2}):(\d{2}):(\d{2}\.\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}\.\d{3})\]\s*(.*)$/;

/**
 * @param {string[]} lines
 * @param {boolean} withTimestamps
 * @returns {import('./types.js').TranscriptResult}
 */
export function parseWhisperOutput(lines, withTimestamps) {
  /** @type {Array<{ text: string, timestamp?: [number, number] }>} */
  const chunks = [];
  for (const line of lines) {
    const m = SEG_RE.exec(line);
    if (!m) {
      continue;
    }
    const start = hmsToSec(m[1], m[2], m[3]);
    const end = hmsToSec(m[4], m[5], m[6]);
    const text = (m[7] || '').trim();
    if (!text) {
      continue;
    }
    chunks.push({ text, timestamp: [start, end] });
  }

  const text = chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!withTimestamps) {
    return { text };
  }
  return { text, chunks };
}

/**
 * @param {string} hh
 * @param {string} mm
 * @param {string} ss
 */
function hmsToSec(hh, mm, ss) {
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}
