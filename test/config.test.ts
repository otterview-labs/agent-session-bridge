import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_API_TOKEN_CHARACTERS, parseConfig } from '../src/config/env.js';

test('keeps localhost operation available without an API token', () => {
  const config = parseConfig({});

  assert.equal(config.httpHost, '127.0.0.1');
  assert.equal(config.apiToken, null);
  assert.equal(config.autoConfirmWorkspaceTrust, false);
});

test('requires a strong API token and workspace roots for remote binding', () => {
  assert.throws(
    () => parseConfig({ ASB_HTTP_HOST: '0.0.0.0' }),
    /ASB_API_TOKEN/u,
  );

  assert.throws(
    () =>
      parseConfig({
        ASB_API_TOKEN: 'a'.repeat(32),
        ASB_HTTP_HOST: '0.0.0.0',
      }),
    /ASB_ALLOWED_WORKSPACE_ROOTS/u,
  );

  assert.throws(
    () =>
      parseConfig({
        ASB_ALLOWED_WORKSPACE_ROOTS: '/srv/projects',
        ASB_API_TOKEN: 'a'.repeat(32),
        ASB_HTTP_HOST: '0.0.0.0',
      }),
    /ASB_ALLOWED_HTTP_HOSTS/u,
  );

  const config = parseConfig({
    ASB_ALLOWED_HTTP_HOSTS: 'asb.example.test',
    ASB_ALLOWED_WORKSPACE_ROOTS: '/srv/projects',
    ASB_API_TOKEN: 'a'.repeat(32),
    ASB_HTTP_HOST: '0.0.0.0',
  });

  assert.equal(config.httpHost, '0.0.0.0');
  assert.deepEqual(config.allowedHttpHosts, ['asb.example.test']);
});

test('requires API tokens that can be transported in HTTP headers', () => {
  assert.throws(
    () => parseConfig({ ASB_API_TOKEN: 'a'.repeat(MAX_API_TOKEN_CHARACTERS + 1) }),
    /ASB_API_TOKEN must contain at most/u,
  );
  assert.throws(
    () => parseConfig({ ASB_API_TOKEN: 'token with spaces' }),
    /visible ASCII characters without spaces/u,
  );
  assert.throws(
    () => parseConfig({ ASB_API_TOKEN: '令牌' }),
    /visible ASCII characters without spaces/u,
  );

  const maximumToken = 'a'.repeat(MAX_API_TOKEN_CHARACTERS);
  assert.equal(parseConfig({ ASB_API_TOKEN: maximumToken }).apiToken, maximumToken);

  const token = 'a'.repeat(32);
  assert.equal(parseConfig({ ASB_API_TOKEN: `  ${token}  ` }).apiToken, token);
});

test('does not treat malformed 127-like hostnames as loopback', () => {
  assert.throws(
    () => parseConfig({ ASB_HTTP_HOST: '127.999.999.999' }),
    /ASB_API_TOKEN/u,
  );
});

test('requires a Feishu allowlist when the channel is enabled', () => {
  assert.throws(
    () =>
      parseConfig({
        ASB_FEISHU_ENABLED: 'true',
      }),
    /Feishu allowlist/u,
  );
});
