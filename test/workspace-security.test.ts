import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WorkspaceService } from '../src/services/workspace-service.js';

test('prevents file previews from escaping through symbolic links', async (t) => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), 'asb-workspace-'));
  t.after(async () => rm(basePath, { force: true, recursive: true }));
  const workspacePath = path.join(basePath, 'workspace');
  const outsidePath = path.join(basePath, 'outside.txt');
  await mkdir(workspacePath);
  await writeFile(outsidePath, 'outside secret', 'utf8');
  await symlink(outsidePath, path.join(workspacePath, 'linked.txt'));

  const service = createWorkspaceService(workspacePath);

  await assert.rejects(
    () => service.readFilePreview('demo', 'linked.txt'),
    /outside workspace/u,
  );
});

test('prevents aliases from bypassing protected filename checks', async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'asb-workspace-'));
  t.after(async () => rm(workspacePath, { force: true, recursive: true }));
  await writeFile(path.join(workspacePath, '.env'), 'SECRET=value', 'utf8');
  await symlink('.env', path.join(workspacePath, 'settings.txt'));

  const service = createWorkspaceService(workspacePath);

  await assert.rejects(
    () => service.readFilePreview('demo', 'settings.txt'),
    /protected/u,
  );
});

test('blocks common credential files and directories from workspace browsing', async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'asb-workspace-'));
  t.after(async () => rm(workspacePath, { force: true, recursive: true }));
  await mkdir(path.join(workspacePath, '.aws'));
  await writeFile(
    path.join(workspacePath, '.aws', 'credentials'),
    'credential = placeholder',
    'utf8',
  );
  await writeFile(path.join(workspacePath, 'token.txt'), 'placeholder', 'utf8');

  const service = createWorkspaceService(workspacePath);
  const listing = await service.listFiles('demo');

  assert.equal(listing.entries.some((entry) => entry.name === '.aws'), false);
  assert.equal(listing.entries.some((entry) => entry.name === 'token.txt'), false);
  await assert.rejects(
    () => service.readFilePreview('demo', '.aws/credentials'),
    /protected/u,
  );
  await assert.rejects(
    () => service.readFilePreview('demo', 'token.txt'),
    /protected/u,
  );
});

test('continues to preview ordinary files inside the workspace', async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'asb-workspace-'));
  t.after(async () => rm(workspacePath, { force: true, recursive: true }));
  await writeFile(path.join(workspacePath, 'README.md'), '# Demo', 'utf8');

  const preview = await createWorkspaceService(workspacePath).readFilePreview(
    'demo',
    'README.md',
  );

  assert.equal(preview.content, '# Demo');
});

function createWorkspaceService(workspacePath: string): WorkspaceService {
  return new WorkspaceService({
    logger: {
      debug: () => undefined,
    } as never,
    maxDiffCharacters: 10_000,
    maxFilePreviewBytes: 10_000,
    maxListEntries: 100,
    sessionService: {
      requireByName: async () => ({
        name: 'demo',
        workspacePath,
      }),
    } as never,
  });
}
