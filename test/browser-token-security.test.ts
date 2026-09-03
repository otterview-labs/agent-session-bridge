import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

type ApiTokenState = {
  get(): string;
  set(value: unknown): void;
};

type CreateApiTokenState = (options: {
  localStorage: RecordingStorage;
  sessionStorage: RecordingStorage;
}) => ApiTokenState;

class RecordingStorage {
  readonly getItemCalls: string[] = [];
  readonly removeItemCalls: string[] = [];
  readonly setItemCalls: Array<{ key: string; value: string }> = [];
  private readonly values: Map<string, string>;

  constructor(entries: ReadonlyArray<readonly [string, string]> = []) {
    this.values = new Map(entries);
  }

  getItem(key: string): string | null {
    this.getItemCalls.push(key);
    return this.values.get(key) ?? null;
  }

  peek(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.removeItemCalls.push(key);
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.setItemCalls.push({ key, value });
    this.values.set(key, value);
  }

  containsValue(value: string): boolean {
    return [...this.values.values()].includes(value);
  }
}

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'public', 'api-token-state.js'),
).href;
const { createApiTokenState } = (await import(moduleUrl)) as {
  createApiTokenState: CreateApiTokenState;
};

test('purges legacy API tokens without restoring them into memory', () => {
  const localStorage = new RecordingStorage([
    ['asb.apiToken', 'legacy-local-secret'],
    ['asb.actorId', 'web-ui'],
  ]);
  const sessionStorage = new RecordingStorage([
    ['asb.apiToken', 'legacy-session-secret'],
  ]);

  const tokenState = createApiTokenState({ localStorage, sessionStorage });

  assert.equal(tokenState.get(), '');
  assert.equal(localStorage.peek('asb.apiToken'), null);
  assert.equal(sessionStorage.peek('asb.apiToken'), null);
  assert.deepEqual(localStorage.getItemCalls, []);
  assert.deepEqual(sessionStorage.getItemCalls, []);
  assert.deepEqual(localStorage.removeItemCalls, ['asb.apiToken']);
  assert.deepEqual(sessionStorage.removeItemCalls, ['asb.apiToken']);
  assert.equal(localStorage.peek('asb.actorId'), 'web-ui');
});

test('keeps newly entered API tokens in memory only and clears them on reload', () => {
  const localStorage = new RecordingStorage();
  const sessionStorage = new RecordingStorage();
  const firstPage = createApiTokenState({ localStorage, sessionStorage });

  firstPage.set('  fresh-secret  ');

  assert.equal(firstPage.get(), 'fresh-secret');
  assert.deepEqual(localStorage.setItemCalls, []);
  assert.deepEqual(sessionStorage.setItemCalls, []);
  assert.equal(localStorage.containsValue('fresh-secret'), false);
  assert.equal(sessionStorage.containsValue('fresh-secret'), false);

  const reloadedPage = createApiTokenState({ localStorage, sessionStorage });
  assert.equal(reloadedPage.get(), '');
});
