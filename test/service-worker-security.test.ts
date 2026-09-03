import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

test('service worker never intercepts API navigations or query-bearing static URLs', async () => {
  const source = await readFile(path.join(process.cwd(), 'public', 'service-worker.js'), 'utf8');
  const listeners = new Map<string, (event: unknown) => void>();
  let cacheWrites = 0;
  const context = {
    URL,
    caches: {
      keys: async () => [],
      match: async () => undefined,
      open: async () => ({
        addAll: async () => undefined,
        match: async () => undefined,
        put: async () => {
          cacheWrites += 1;
        },
      }),
    },
    fetch: async () => ({
      clone: () => ({}),
      ok: true,
    }),
    self: {
      addEventListener: (name: string, listener: (event: unknown) => void) => {
        listeners.set(name, listener);
      },
      clients: {
        claim: () => undefined,
      },
      location: {
        origin: 'https://asb.example.test',
      },
      skipWaiting: () => undefined,
    },
  };
  vm.runInNewContext(source, context, { filename: 'service-worker.js' });
  const fetchListener = listeners.get('fetch');
  assert.ok(fetchListener);

  let intercepted = false;
  fetchListener({
    request: {
      method: 'GET',
      mode: 'navigate',
      url: 'https://asb.example.test/sessions',
    },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false, 'API navigation must bypass the shell cache');

  fetchListener({
    request: {
      method: 'GET',
      mode: 'cors',
      url: 'https://asb.example.test/app.js?token=do-not-cache',
    },
    respondWith: () => {
      intercepted = true;
    },
  });
  assert.equal(intercepted, false, 'query-bearing static requests must bypass Cache Storage');
  assert.equal(cacheWrites, 0);
});
