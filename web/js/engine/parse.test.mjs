import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhisperOutput } from './whisper-parse.js';

test('parseWhisperOutput extracts segments', () => {
  const lines = [
    'system_info: n_threads = 4',
    '[00:00:00.000 --> 00:00:02.000]  Hello world',
    '[00:00:02.000 --> 00:00:04.500]  this is a test',
    'whisper_print_timings: total time = 123.4 ms',
  ];
  const withTs = parseWhisperOutput(lines, true);
  assert.equal(withTs.chunks.length, 2);
  assert.equal(withTs.chunks[0].text, 'Hello world');
  assert.deepEqual(withTs.chunks[0].timestamp, [0, 2]);
  assert.equal(withTs.text, 'Hello world this is a test');

  const plain = parseWhisperOutput(lines, false);
  assert.equal(plain.text, 'Hello world this is a test');
  assert.equal(plain.chunks, undefined);
});
