import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WorkspaceService } from '../src/services/workspace-service.js';

test('reads Git status and diff without executing repository clean filters', async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'asb-git-safe-'));
  const markerPath = path.join(workspacePath, 'filter-executed');
  t.after(async () => rm(workspacePath, { force: true, recursive: true }));

  initializeRepository(workspacePath);
  await mkdir(path.join(workspacePath, '.aws'));
  await writeFile(path.join(workspacePath, 'README.md'), 'before\n', 'utf8');
  await writeFile(path.join(workspacePath, '.env'), 'SECRET=before\n', 'utf8');
  await writeFile(
    path.join(workspacePath, '.aws', 'credentials'),
    'credential = before\n',
    'utf8',
  );
  runGit(workspacePath, ['add', '.']);
  runGit(workspacePath, ['commit', '-qm', 'initial']);

  runGit(workspacePath, [
    'config',
    'filter.asb-security-test.clean',
    `sh -c 'printf executed > "${markerPath}"'`,
  ]);
  await writeFile(
    path.join(workspacePath, '.gitattributes'),
    'README.md filter=asb-security-test\n',
    'utf8',
  );
  await writeFile(path.join(workspacePath, 'README.md'), 'after\n', 'utf8');
  await writeFile(path.join(workspacePath, '.env'), 'SECRET=after\n', 'utf8');
  await writeFile(
    path.join(workspacePath, '.aws', 'credentials'),
    'credential = after\n',
    'utf8',
  );

  const indexBefore = await readFile(path.join(workspacePath, '.git', 'index'));
  const service = createWorkspaceService(workspacePath);
  const status = await service.getGitStatus('test');
  const diff = await service.getGitDiff('test', 'README.md');
  const indexAfter = await readFile(path.join(workspacePath, '.git', 'index'));

  assert.equal(status.available, true, status.reason ?? 'Git status unexpectedly unavailable');
  assert.equal(status.entries.some((entry) => entry.path === 'README.md'), true);
  assert.equal(status.entries.some((entry) => entry.path === '.env'), false);
  assert.equal(status.entries.some((entry) => entry.path.includes('credentials')), false);
  assert.equal(diff.available, true, diff.reason ?? 'Git diff unexpectedly unavailable');
  assert.match(diff.content, /before/u);
  assert.match(diff.content, /after/u);
  assert.deepEqual(indexAfter, indexBefore, 'status inspection must not refresh the Git index');
  await assert.rejects(access(markerPath), /ENOENT/u);

  const protectedDiff = await service.getGitDiff('test', '.env');
  assert.equal(protectedDiff.available, false);
  assert.match(protectedDiff.reason ?? '', /protected/u);
});

test('rejects Git metadata that is symlinked outside the workspace', async (t) => {
  const parentPath = await mkdtemp(path.join(os.tmpdir(), 'asb-git-metadata-'));
  const repositoryPath = path.join(parentPath, 'repository');
  const workspacePath = path.join(parentPath, 'workspace');
  t.after(async () => rm(parentPath, { force: true, recursive: true }));

  await mkdir(repositoryPath);
  await mkdir(workspacePath);
  initializeRepository(repositoryPath);
  await symlink(path.join(repositoryPath, '.git'), path.join(workspacePath, '.git'));

  const status = await createWorkspaceService(workspacePath).getGitStatus('test');

  assert.equal(status.available, false);
  assert.match(status.reason ?? '', /External Git metadata/u);
});

test('rejects nested Git metadata symlinks that escape the workspace', async (t) => {
  const parentPath = await mkdtemp(path.join(os.tmpdir(), 'asb-git-index-'));
  const externalRepositoryPath = path.join(parentPath, 'external');
  const workspacePath = path.join(parentPath, 'workspace');
  t.after(async () => rm(parentPath, { force: true, recursive: true }));

  await mkdir(externalRepositoryPath);
  await mkdir(workspacePath);
  initializeRepository(externalRepositoryPath);
  initializeRepository(workspacePath);

  for (const repositoryPath of [externalRepositoryPath, workspacePath]) {
    await writeFile(path.join(repositoryPath, 'README.md'), 'initial\n', 'utf8');
    runGit(repositoryPath, ['add', 'README.md']);
    runGit(repositoryPath, ['commit', '-qm', 'initial']);
  }

  await rm(path.join(workspacePath, '.git', 'index'));
  await symlink(
    path.join(externalRepositoryPath, '.git', 'index'),
    path.join(workspacePath, '.git', 'index'),
  );

  const status = await createWorkspaceService(workspacePath).getGitStatus('test');

  assert.equal(status.available, false);
  assert.match(status.reason ?? '', /symlink.*outside/u);
});

function createWorkspaceService(workspacePath: string): WorkspaceService {
  return new WorkspaceService({
    logger: {
      debug: () => undefined,
    } as never,
    maxDiffCharacters: 24_000,
    maxFilePreviewBytes: 64_000,
    maxListEntries: 200,
    sessionService: {
      requireByName: async () => ({
        name: 'test',
        workspacePath,
      }),
    } as never,
  });
}

function initializeRepository(workspacePath: string): void {
  runGit(workspacePath, ['init', '-q']);
  runGit(workspacePath, ['config', 'user.name', 'ASB Security Test']);
  runGit(workspacePath, ['config', 'user.email', 'asb-security@example.invalid']);
}

function runGit(workspacePath: string, args: string[]): void {
  execFileSync('git', args, {
    cwd: workspacePath,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
    stdio: 'pipe',
  });
}
