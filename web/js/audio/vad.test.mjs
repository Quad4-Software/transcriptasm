import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnergyVad } from './vad.js';

test('vad ignores silence', () => {
  /** @type {Float32Array[]} */
  const ends = [];
  const vad = createEnergyVad({
    onSpeechEnd: (pcm) => ends.push(pcm),
    threshold: 0.02,
    hangoverMs: 100,
    minSpeechMs: 50,
    maxChunkMs: 2000,
  });
  vad.push(new Float32Array(1600));
  vad.flush();
  assert.equal(ends.length, 0);
});

test('vad emits speech then silence', () => {
  /** @type {Array<{ len: number, t0: number, t1: number }>} */
  const ends = [];
  const vad = createEnergyVad({
    onSpeechEnd: (pcm, t0, t1) => ends.push({ len: pcm.length, t0, t1 }),
    threshold: 0.02,
    hangoverMs: 100,
    minSpeechMs: 50,
    maxChunkMs: 5000,
    sampleRate: 16000,
  });
  const speech = new Float32Array(1600);
  speech.fill(0.2);
  vad.push(speech);
  const silence = new Float32Array(2000);
  vad.push(silence);
  assert.equal(ends.length, 1);
  assert.ok(ends[0].len >= 800);
  assert.ok(ends[0].t1 > ends[0].t0);
});

test('vad max chunk splits long speech', () => {
  /** @type {number[]} */
  const lens = [];
  const vad = createEnergyVad({
    onSpeechEnd: (pcm) => lens.push(pcm.length),
    threshold: 0.01,
    hangoverMs: 50,
    minSpeechMs: 20,
    maxChunkMs: 100,
    sampleRate: 16000,
  });
  const long = new Float32Array(4800);
  long.fill(0.3);
  vad.push(long);
  assert.ok(lens.length >= 2);
});

test('vad emit returns standalone Float32Array', () => {
  /** @type {Float32Array[]} */
  const ends = [];
  const vad = createEnergyVad({
    onSpeechEnd: (pcm) => ends.push(pcm),
    threshold: 0.02,
    hangoverMs: 50,
    minSpeechMs: 20,
    maxChunkMs: 5000,
    sampleRate: 16000,
  });
  const speech = new Float32Array(800);
  speech.fill(0.25);
  vad.push(speech);
  vad.flush();
  assert.equal(ends.length, 1);
  assert.ok(ends[0] instanceof Float32Array);
  assert.equal(ends[0].byteOffset, 0);
  assert.equal(ends[0].buffer.byteLength, ends[0].byteLength);
});
