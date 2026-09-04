import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleLinear, toMono } from './resample.js';
import { GrowablePCM } from './pcm-buffer.js';

test('resample same rate returns same reference', () => {
  const input = new Float32Array([0, 0.5, 1]);
  const out = resampleLinear(input, 16000, 16000);
  assert.equal(out, input);
});

test('resample doubles length for 8k to 16k', () => {
  const input = new Float32Array(8000);
  for (let i = 0; i < input.length; i++) input[i] = i / 8000;
  const out = resampleLinear(input, 8000, 16000);
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(out[0] - input[0]) < 1e-6);
});

test('toMono averages channels without extra copy when mono', () => {
  const input = new Float32Array([1, 2, 3]);
  assert.equal(toMono(input, 1), input);
});

test('GrowablePCM grows and take copies', () => {
  const g = new GrowablePCM(4);
  g.push(new Float32Array([1, 2, 3]));
  g.push(new Float32Array([4, 5]));
  assert.equal(g.length, 5);
  const taken = g.take();
  assert.deepEqual([...taken], [1, 2, 3, 4, 5]);
  assert.equal(g.length, 0);
});
