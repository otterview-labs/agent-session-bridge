import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HttpApiServer,
  MAX_AUTHORIZATION_HEADER_CHARACTERS,
  parseBearerToken,
  parseHostHeader,
  tokensMatch,
} from '../src/app/http-server.js';

test('parses Bearer authorization with bounded linear operations', () => {
  assert.equal(parseBearerToken('Bearer token-value'), 'token-value');
  assert.equal(parseBearerToken('bEaReR token-value'), 'token-value');
  assert.equal(parseBearerToken('Bearer    token-value  '), 'token-value');

  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken('Basic token-value'), null);
  assert.equal(parseBearerToken('Bearertoken-value'), null);
  assert.equal(parseBearerToken('Bearer'), '');
  assert.equal(parseBearerToken('Bearer\ttoken-value'), '');
  assert.equal(parseBearerToken('Bearer\ntoken-value'), '');
  assert.equal(parseBearerToken('Bearer:token-value'), '');
  assert.equal(parseBearerToken('Bearer\u0085token-value'), '');
  assert.equal(parseBearerToken('Bearer\u00a0token-value'), '');
  assert.equal(parseBearerToken('Bearer token\n'), '');
  assert.equal(parseBearerToken('Bearer token\r'), '');
  assert.equal(parseBearerToken('Bearer token\u007f'), '');
  assert.equal(parseBearerToken('Bearer token\u2028'), '');
  assert.equal(parseBearerToken('Bearer token\u2029'), '');
  assert.equal(parseBearerToken('Bearer token value'), '');
  assert.equal(parseBearerToken('Bearer token\u0085value'), '');
  assert.equal(parseBearerToken('Bearer téken'), '');
  assert.equal(parseBearerToken('Bearer '), '');
  assert.equal(parseBearerToken('Bearer     '), '');

  const maximumToken = 'a'.repeat(MAX_AUTHORIZATION_HEADER_CHARACTERS - 7);
  assert.equal(parseBearerToken(`Bearer ${maximumToken}`), maximumToken);
  assert.equal(parseBearerToken(`Bearer ${maximumToken}a`), '');
});

test('compares bearer tokens without length-dependent exceptions', () => {
  assert.equal(tokensMatch('same-token', 'same-token'), true);
  assert.equal(tokensMatch('same-token', 'other-toke'), false);
  assert.equal(tokensMatch('short', 'a-much-longer-token'), false);
  assert.equal(tokensMatch('é', 'é'), true);
  assert.equal(tokensMatch('é', 'e\u0301'), false);
  assert.equal(tokensMatch('\ud800', '\ud801'), false);
});

test('serves the in-memory token module before API authorization', async (t) => {
  const server = new HttpApiServer({
    config: {
      allowedHttpHosts: [],
      apiToken: 'x'.repeat(32),
      httpHost: '127.0.0.1',
      httpPort: 0,
    },
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
  } as never);
  const { port } = await server.start();
  t.after(async () => server.stop());

  const response = await fetch(`http://127.0.0.1:${port}/api-token-state.js`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/javascript/u);
  assert.match(await response.text(), /export function createApiTokenState/u);
});

test('fails closed for malformed Bearer values before considering the raw token', async (t) => {
  const apiToken = 'x'.repeat(MAX_AUTHORIZATION_HEADER_CHARACTERS - 7);
  const server = new HttpApiServer({
    config: {
      allowedHttpHosts: [],
      apiToken,
      httpHost: '127.0.0.1',
      httpPort: 0,
    },
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
    supervisorService: {
      getState: () => ({
        enabled: false,
        latestSnapshots: [],
      }),
    },
  } as never);
  const { port } = await server.start();
  t.after(async () => server.stop());
  const url = `http://127.0.0.1:${port}/health`;

  const rawOnly = await fetch(url, {
    headers: { 'X-ASB-Token': apiToken },
  });
  assert.equal(rawOnly.status, 200);

  const bearerOnly = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  assert.equal(bearerOnly.status, 200);

  const proxyAuthorization = await fetch(url, {
    headers: {
      Authorization: 'Basic proxy-credential',
      'X-ASB-Token': apiToken,
    },
  });
  assert.equal(proxyAuthorization.status, 200);

  for (const authorization of [
    'Bearer',
    'Bearer\twrong',
    'Bearer:wrong',
    'Bearer wrong',
  ]) {
    const response = await fetch(url, {
      headers: {
        Authorization: authorization,
        'X-ASB-Token': apiToken,
      },
    });
    assert.equal(response.status, 401, authorization);
  }
});

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
