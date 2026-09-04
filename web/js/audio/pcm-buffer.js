/**
 * Growable Float32 ring for mic capture with rare reallocs.
 */
export class GrowablePCM {
  /**
   * @param {number} [capacity]
   */
  constructor(capacity = 16000 * 8) {
    this.buf = new Float32Array(capacity);
    this.length = 0;
  }

  /**
   * @param {Float32Array} src
   */
  push(src) {
    const need = this.length + src.length;
    if (need > this.buf.length) {
      let cap = this.buf.length || 1;
      while (cap < need) {
        cap *= 2;
      }
      const next = new Float32Array(cap);
      next.set(this.buf.subarray(0, this.length));
      this.buf = next;
    }
    this.buf.set(src, this.length);
    this.length = need;
  }

  /**
   * Returns a view (no copy). Caller must copy if retention is required past reset.
   * @returns {Float32Array}
   */
  view() {
    return this.buf.subarray(0, this.length);
  }

  /**
   * @returns {Float32Array}
   */
  take() {
    const out = this.buf.slice(0, this.length);
    this.length = 0;
    return out;
  }

  reset() {
    this.length = 0;
  }
}
