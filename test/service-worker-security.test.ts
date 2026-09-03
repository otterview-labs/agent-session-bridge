import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

test('service worker upgrades safe shell assets without caching private routes', async () => {
  const source = await readFile(path.join(process.cwd(), 'public', 'service-worker.js'), 'utf8');
  const listeners = new Map<string, (event: unknown) => void>();
  let cacheWrites = 0;
  let installedAssets: string[] = [];
  const deletedCaches: string[] = [];
  const context = {
    URL,
    caches: {
      delete: async (key: string) => {
        deletedCaches.push(key);
        return true;
      },
      keys: async () => [
        'asb-shell-v2',
        'asb-shell-v3',
        'asb-shell-v4',
        'unrelated-cache',
      ],
      match: async () => undefined,
      open: async () => ({
        addAll: async (assets: string[]) => {
          installedAssets = [...assets];
        },
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

  const installListener = listeners.get('install');
  assert.ok(installListener);
  let installation: Promise<unknown> | undefined;
  installListener({
    waitUntil: (promise: Promise<unknown>) => {
      installation = promise;
    },
  });
  assert.ok(installation);
  await installation;
  assert.equal(installedAssets.includes('/api-token-state.js'), true);

  const activateListener = listeners.get('activate');
  assert.ok(activateListener);
  let activation: Promise<unknown> | undefined;
  activateListener({
    waitUntil: (promise: Promise<unknown>) => {
      activation = promise;
    },
  });
  assert.ok(activation);
  await activation;
  assert.deepEqual(deletedCaches, ['asb-shell-v2', 'asb-shell-v3']);

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
