import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHostHeader } from '../src/app/http-server.js';

test('accepts canonical HTTP Host header forms', () => {
  assert.equal(parseHostHeader('localhost:8787'), 'localhost');
  assert.equal(parseHostHeader('127.0.0.1'), '127.0.0.1');
  assert.equal(parseHostHeader('[::1]:8787'), '::1');
  assert.equal(parseHostHeader('ASB.example.test:443'), 'asb.example.test');
});

test('rejects malformed or authority-confusing Host headers', () => {
  const invalidHeaders = [
    'evil.example@asb.example.test',
    'asb.example.test/path',
    'asb.example.test?next=evil',
    'asb.example.test#fragment',
    'asb.example.test,evil.example',
    ' asb.example.test',
    'asb.example.test:0',
    'asb.example.test:65536',
    '[::1',
    '::1',
    '-invalid.example',
  ];

  for (const header of invalidHeaders) {
    assert.throws(() => parseHostHeader(header), /Host header is invalid/u, header);
  }
});
