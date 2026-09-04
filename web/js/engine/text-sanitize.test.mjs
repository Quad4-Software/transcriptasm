import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseRepeatLoops,
  joinChunkText,
  sanitizeTranscriptChunks,
  scaledAudioCtx,
} from './text-sanitize.js';

test('collapseRepeatLoops collapses foam foam foam', () => {
  const got = collapseRepeatLoops('too full for sound and foam foam foam foam');
  assert.equal(got, 'too full for sound and foam');
});

test('collapseRepeatLoops collapses short phrase loops', () => {
  const got = collapseRepeatLoops('hello world hello world hello world');
  assert.equal(got, 'hello world');
});

test('collapseRepeatLoops leaves normal speech alone', () => {
  const s = 'the rain in Spain falls mainly on the plain';
  assert.equal(collapseRepeatLoops(s), s);
});

test('joinChunkText joins with spaces', () => {
  assert.equal(joinChunkText([{ text: 'a' }, { text: 'b' }]), 'a b');
  assert.equal(joinChunkText([]), '');
});

test('sanitizeTranscriptChunks collapses and keeps timestamps', () => {
  const got = sanitizeTranscriptChunks([
    { text: '  foam foam foam foam  ', timestamp: [0, 1.5] },
    { text: '', timestamp: [1.5, 2] },
    { text: 'ok', timestamp: [2, 3] },
  ]);
  assert.equal(got.text, 'foam ok');
  assert.equal(got.chunks.length, 2);
  assert.deepEqual(got.chunks[0].timestamp, [0, 1.5]);
});

test('scaledAudioCtx follows length formula and clamps', () => {
  assert.equal(scaledAudioCtx(0), 128);
  assert.equal(scaledAudioCtx(5 * 16000), Math.floor((5 / 30) * 1500) + 128);
  assert.equal(scaledAudioCtx(24 * 16000), Math.floor((24 / 30) * 1500) + 128);
  assert.equal(scaledAudioCtx(60 * 16000), 1500);
  assert.notEqual(scaledAudioCtx(24 * 16000), 768);
});
