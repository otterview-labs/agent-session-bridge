import fs from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { createTwoFilesPatch } from 'diff';
import {
  currentBranch,
  readBlob,
  STAGE,
  statusMatrix,
  walk,
  WORKDIR,
  type FsClient,
  type StatusRow,
} from 'isomorphic-git';
import type { Logger } from 'pino';

import { DomainError } from '../domain/errors.js';
import type {
  GitStatusEntry,
  WorkspaceFilePreview,
  WorkspaceGitDiff,
  WorkspaceGitStatus,
  WorkspaceListing,
} from '../domain/workspace.js';
import { SessionService } from './session-service.js';

const MAX_DIFF_INPUT_BYTES = 1024 * 1024;

type GitDiffTreeEntry = {
  stageOid: string | null;
  stageSize: number;
  workdirContent: Uint8Array | null;
  workdirSize: number;
};

type ConfinedGitFileSystem = {
  assertNoViolation(): void;
  client: FsClient;
};

type WorkspaceServiceOptions = {
  logger: Logger;
  maxDiffCharacters: number;
  maxFilePreviewBytes: number;
  maxListEntries: number;
  sessionService: SessionService;
};

export class WorkspaceService {
  constructor(private readonly options: WorkspaceServiceOptions) {}

  async listFiles(sessionName: string, relativePath = ''): Promise<WorkspaceListing> {
    const session = await this.options.sessionService.requireByName(sessionName);
    const safePath = await this.resolveWorkspacePath(session.workspacePath, relativePath);
    const dirents = await readdir(safePath, { withFileTypes: true });
    const entries = await Promise.all(
      dirents
        .sort(compareDirents)
        .slice(0, this.options.maxListEntries)
        .map(async (dirent) => {
          const absolutePath = path.join(safePath, dirent.name);
          const fileStat = await lstat(absolutePath);
          const nextRelativePath = toRelativeWorkspacePath(
            session.workspacePath,
            absolutePath,
          );

          if (isProtectedRelativePath(nextRelativePath, dirent.isDirectory())) {
            return null;
          }

          return {
            isDirectory: dirent.isDirectory(),
            modifiedAt: fileStat.mtime.toISOString(),
            name: dirent.name,
            path: nextRelativePath,
            size: fileStat.size,
          };
        }),
    );

    return {
      entries: entries
        .filter((entry): entry is WorkspaceListing['entries'][number] => entry !== null),
      path: normalizeRelativePath(relativePath),
      sessionName: session.name,
      workspacePath: session.workspacePath,
    };
  }

  async readFilePreview(
    sessionName: string,
    relativePath: string,
  ): Promise<WorkspaceFilePreview> {
    if (!relativePath.trim()) {
      throw new DomainError('File path is required');
    }

    const session = await this.options.sessionService.requireByName(sessionName);
    const normalizedPath = normalizeRelativePath(relativePath);

    if (isProtectedRelativePath(normalizedPath, false)) {
      throw new DomainError(`Path is protected and cannot be previewed: ${normalizedPath}`);
    }

    const safePath = await this.resolveWorkspacePath(session.workspacePath, relativePath);
    const canonicalWorkspacePath = await realpath(session.workspacePath);
    const canonicalRelativePath = toRelativeWorkspacePath(
      canonicalWorkspacePath,
      safePath,
    );

    if (isProtectedRelativePath(canonicalRelativePath, false)) {
      throw new DomainError(
        `Path is protected and cannot be previewed: ${normalizedPath}`,
      );
    }
    const fileStat = await stat(safePath);

    if (!fileStat.isFile()) {
      throw new DomainError(`Path is not a file: ${normalizedPath}`);
    }

    const bytesToRead = Math.min(fileStat.size, this.options.maxFilePreviewBytes + 1);
    const buffer = Buffer.alloc(bytesToRead);
    const file = await open(safePath, 'r');
    let bytesRead = 0;

    try {
      ({ bytesRead } = await file.read(buffer, 0, bytesToRead, 0));
    } finally {
      await file.close();
    }

    const capturedBuffer = buffer.subarray(0, bytesRead);
    const isBinary = looksBinary(capturedBuffer);
    const previewBuffer = capturedBuffer.subarray(0, this.options.maxFilePreviewBytes);
    const content = isBinary ? null : previewBuffer.toString('utf8');

    return {
      content,
      isBinary,
      isTruncated: fileStat.size > this.options.maxFilePreviewBytes,
      path: normalizedPath,
      sessionName: session.name,
      size: fileStat.size,
      workspacePath: session.workspacePath,
    };
  }

  async getGitStatus(sessionName: string): Promise<WorkspaceGitStatus> {
    const session = await this.options.sessionService.requireByName(sessionName);
    try {
      const workspacePath = await realpath(session.workspacePath);
      const gitdir = await this.requireContainedGitDirectory(workspacePath);
      const gitFs = this.createConfinedGitFileSystem(workspacePath);
      const cache = {};
      const [branch, matrix] = await Promise.all([
        currentBranch({ dir: workspacePath, fs: gitFs.client, gitdir }),
        statusMatrix({
          cache,
          dir: workspacePath,
          filter: (filepath) => !isProtectedRelativePath(filepath, false),
          fs: gitFs.client,
          gitdir,
          refresh: false,
        }),
      ]);
      gitFs.assertNoViolation();
      const entries = matrix
        .map(mapGitStatusRow)
        .filter((entry): entry is GitStatusEntry => entry !== null)
        .slice(0, this.options.maxListEntries);

      return {
        available: true,
        branch: branch ?? null,
        clean: entries.length === 0,
        entries,
        reason: null,
        sessionName: session.name,
        workspacePath: session.workspacePath,
      };
    } catch (error) {
      this.options.logger.debug(
        { err: error, sessionName },
        'git status unavailable',
      );
      return {
        available: false,
        branch: null,
        clean: true,
        entries: [],
        reason: renderGitUnavailableReason(error),
        sessionName: session.name,
        workspacePath: session.workspacePath,
      };
    }
  }

  async getGitDiff(
    sessionName: string,
    relativePath?: string,
  ): Promise<WorkspaceGitDiff> {
    const session = await this.options.sessionService.requireByName(sessionName);
    const requestedPath = relativePath?.trim()
      ? normalizeRelativePath(relativePath)
      : null;

    try {
      if (requestedPath) {
        this.resolveWorkspacePathLexically(session.workspacePath, requestedPath);

        if (isProtectedRelativePath(requestedPath, false)) {
          throw new DomainError(`Path is protected and cannot be diffed: ${requestedPath}`);
        }
      }

      const workspacePath = await realpath(session.workspacePath);
      const gitdir = await this.requireContainedGitDirectory(workspacePath);
      const gitFs = this.createConfinedGitFileSystem(workspacePath);
      const matrix = await statusMatrix({
        dir: workspacePath,
        filepaths: requestedPath ? [requestedPath] : ['.'],
        filter: (filepath) => !isProtectedRelativePath(filepath, false),
        fs: gitFs.client,
        gitdir,
        refresh: false,
      });
      gitFs.assertNoViolation();
      const allChangedPaths = matrix
        .filter(([, , workdirStatus, stageStatus]) => workdirStatus !== stageStatus)
        .map(([filepath]) => filepath);
      const changedPaths = allChangedPaths.slice(0, this.options.maxListEntries);
      let content = '';
      let omittedFiles = 0;

      for (const filepath of changedPaths) {
        const remainingCharacters = this.options.maxDiffCharacters - content.length;

        if (remainingCharacters <= 0) {
          omittedFiles += 1;
          continue;
        }

        const entry = await this.readGitDiffTreeEntry(
          workspacePath,
          gitdir,
          gitFs,
          filepath,
        );
        gitFs.assertNoViolation();

        if (!entry) {
          continue;
        }

        const rendered = await this.renderGitDiffEntry(
          workspacePath,
          gitdir,
          gitFs,
          filepath,
          entry,
        );
        gitFs.assertNoViolation();
        content += rendered.slice(0, remainingCharacters);
        if (rendered.length > remainingCharacters) {
          omittedFiles += 1;
        }
      }

      if (allChangedPaths.length > changedPaths.length) {
        omittedFiles += allChangedPaths.length - changedPaths.length;
      }

      const isTruncated = omittedFiles > 0;
      if (isTruncated && content.length < this.options.maxDiffCharacters) {
        const notice = `\n... diff truncated; ${omittedFiles} file(s) omitted ...\n`;
        content += notice.slice(0, this.options.maxDiffCharacters - content.length);
      }

      return {
        available: true,
        content,
        isTruncated,
        path: requestedPath,
        reason: null,
        sessionName: session.name,
        workspacePath: session.workspacePath,
      };
    } catch (error) {
      this.options.logger.debug(
        { err: error, path: requestedPath, sessionName },
        'git diff unavailable',
      );
      return {
        available: false,
        content: '',
        isTruncated: false,
        path: requestedPath,
        reason: renderGitUnavailableReason(error),
        sessionName: session.name,
        workspacePath: session.workspacePath,
      };
    }
  }

  private async requireContainedGitDirectory(workspacePath: string): Promise<string> {
    const dotGitPath = path.join(workspacePath, '.git');
    let dotGitStat;

    try {
      dotGitStat = await lstat(dotGitPath);
    } catch {
      throw new DomainError('Workspace is not a supported Git repository');
    }

    // Git worktree/submodule pointer files and symlinked metadata may point
    // outside the selected workspace. Keep the read-only browser confined to
    // a normal, in-workspace .git directory.
    if (!dotGitStat.isDirectory() || dotGitStat.isSymbolicLink()) {
      throw new DomainError('External Git metadata is not supported');
    }

    const canonicalGitDirectory = await realpath(dotGitPath);
    this.ensurePathContained(workspacePath, canonicalGitDirectory, '.git');
    return canonicalGitDirectory;
  }

  private async readGitDiffTreeEntry(
    workspacePath: string,
    gitdir: string,
    gitFs: ConfinedGitFileSystem,
    targetPath: string,
  ): Promise<GitDiffTreeEntry | null> {
    const results = (await walk({
      dir: workspacePath,
      fs: gitFs.client,
      gitdir,
      trees: [STAGE(), WORKDIR({ refresh: false })],
      map: async (filepath, [stageEntry, workdirEntry]) => {
        if (!isPathOnRoute(filepath, targetPath)) {
          return null;
        }

        if (filepath !== targetPath) {
          return undefined;
        }

        const [stageType, workdirType] = await Promise.all([
          stageEntry?.type(),
          workdirEntry?.type(),
        ]);

        if (stageType !== 'blob' && workdirType !== 'blob') {
          return undefined;
        }

        const [stageOid, stageStat, workdirStat] = await Promise.all([
          stageType === 'blob' ? stageEntry?.oid() : null,
          stageType === 'blob' ? stageEntry?.stat() : null,
          workdirType === 'blob' ? workdirEntry?.stat() : null,
        ]);
        const stageSize = stageStat?.size ?? 0;
        const workdirSize = workdirStat?.size ?? 0;
        const workdirContent =
          workdirType === 'blob' && workdirSize <= MAX_DIFF_INPUT_BYTES
            ? (await workdirEntry?.content()) ?? null
            : null;

        return {
          stageOid: stageOid ?? null,
          stageSize,
          workdirContent,
          workdirSize,
        } satisfies GitDiffTreeEntry;
      },
    })) as GitDiffTreeEntry[];

    return results.find((entry) => entry && typeof entry === 'object') ?? null;
  }

  private async renderGitDiffEntry(
    workspacePath: string,
    gitdir: string,
    gitFs: ConfinedGitFileSystem,
    filepath: string,
    entry: GitDiffTreeEntry,
  ): Promise<string> {
    const displayPath = sanitizeDiffPath(filepath);

    if (
      entry.stageSize > MAX_DIFF_INPUT_BYTES ||
      entry.workdirSize > MAX_DIFF_INPUT_BYTES
    ) {
      return `diff --git a/${displayPath} b/${displayPath}\nDiff omitted: file exceeds ${MAX_DIFF_INPUT_BYTES} bytes.\n`;
    }

    const stageContent = entry.stageOid
      ? Buffer.from(
          (
            await readBlob({
              dir: workspacePath,
              fs: gitFs.client,
              gitdir,
              oid: entry.stageOid,
            })
          ).blob,
        )
      : Buffer.alloc(0);
    const workdirContent = entry.workdirContent
      ? Buffer.from(entry.workdirContent)
      : Buffer.alloc(0);

    if (stageContent.byteLength > MAX_DIFF_INPUT_BYTES) {
      return `diff --git a/${displayPath} b/${displayPath}\nDiff omitted: staged blob exceeds ${MAX_DIFF_INPUT_BYTES} bytes.\n`;
    }

    if (looksBinary(stageContent) || looksBinary(workdirContent)) {
      return `diff --git a/${displayPath} b/${displayPath}\nBinary files differ.\n`;
    }

    return createTwoFilesPatch(
      `a/${displayPath}`,
      `b/${displayPath}`,
      stageContent.toString('utf8'),
      workdirContent.toString('utf8'),
      '',
      '',
      { context: 3 },
    );
  }

  private createConfinedGitFileSystem(workspacePath: string): ConfinedGitFileSystem {
    let violation: string | null = null;

    const recordViolation = (message: string): never => {
      violation ??= message;
      throw new DomainError(message);
    };
    const resolveLexicalPath = (requestedPath: string): string => {
      const candidatePath = path.isAbsolute(requestedPath)
        ? path.resolve(requestedPath)
        : path.resolve(workspacePath, requestedPath);
      const relativePath = path.relative(workspacePath, candidatePath);

      if (
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        return recordViolation('Git inspection attempted to access a path outside the workspace');
      }

      return candidatePath;
    };
    const resolveCanonicalPath = async (requestedPath: string): Promise<string> => {
      const candidatePath = resolveLexicalPath(requestedPath);
      const canonicalPath = await realpath(candidatePath);
      const relativePath = path.relative(workspacePath, canonicalPath);

      if (
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        return recordViolation('Git inspection encountered a symlink outside the workspace');
      }

      return canonicalPath;
    };
    const resolvePathWithoutFollowingFinalSymlink = async (
      requestedPath: string,
    ): Promise<string> => {
      const candidatePath = resolveLexicalPath(requestedPath);

      if (candidatePath === workspacePath) {
        return candidatePath;
      }

      const canonicalParent = await realpath(path.dirname(candidatePath));
      const relativeParent = path.relative(workspacePath, canonicalParent);

      if (
        relativeParent === '..' ||
        relativeParent.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeParent)
      ) {
        return recordViolation('Git inspection encountered a symlinked parent outside the workspace');
      }

      return candidatePath;
    };
    const rejectWrite = async (): Promise<never> => {
      throw new DomainError('Git inspection filesystem is read-only');
    };

    const client: FsClient = {
      promises: {
        lstat: async (requestedPath: string, options?: unknown) =>
          fs.promises.lstat(
            await resolvePathWithoutFollowingFinalSymlink(requestedPath),
            options as never,
          ),
        mkdir: rejectWrite,
        readFile: async (requestedPath: string, options?: unknown) =>
          fs.promises.readFile(await resolveCanonicalPath(requestedPath), options as never),
        readdir: async (requestedPath: string, options?: unknown) =>
          fs.promises.readdir(await resolveCanonicalPath(requestedPath), options as never),
        readlink: async (requestedPath: string, options?: unknown) =>
          fs.promises.readlink(
            await resolvePathWithoutFollowingFinalSymlink(requestedPath),
            options as never,
          ),
        rmdir: rejectWrite,
        stat: async (requestedPath: string, options?: unknown) =>
          fs.promises.stat(await resolveCanonicalPath(requestedPath), options as never),
        symlink: rejectWrite,
        unlink: rejectWrite,
        writeFile: rejectWrite,
      },
    };

    return {
      assertNoViolation(): void {
        if (violation) {
          throw new DomainError(violation);
        }
      },
      client,
    };
  }

  private async resolveWorkspacePath(
    workspacePath: string,
    relativePath: string,
  ): Promise<string> {
    const canonicalWorkspacePath = await realpath(workspacePath);
    const candidatePath = this.resolveWorkspacePathLexically(
      canonicalWorkspacePath,
      relativePath,
    );
    const canonicalTargetPath = await realpath(candidatePath);
    this.ensurePathContained(canonicalWorkspacePath, canonicalTargetPath, relativePath);
    return canonicalTargetPath;
  }

  private resolveWorkspacePathLexically(
    workspacePath: string,
    relativePath: string,
  ): string {
    if (path.isAbsolute(relativePath.trim())) {
      throw new DomainError(`Path must be relative to the workspace: ${relativePath}`);
    }

    const normalizedRelativePath = normalizeRelativePath(relativePath);
    const resolvedPath = path.resolve(workspacePath, normalizedRelativePath || '.');
    this.ensurePathContained(workspacePath, resolvedPath, relativePath);
    return resolvedPath;
  }

  private ensurePathContained(
    workspacePath: string,
    targetPath: string,
    requestedPath: string,
  ): void {
    const relativeToRoot = path.relative(workspacePath, targetPath);

    if (
      relativeToRoot === '..' ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new DomainError(
        `Path "${requestedPath}" is outside workspace "${workspacePath}"`,
      );
    }
  }
}

function normalizeRelativePath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/');

  if (!trimmed || trimmed === '.' || trimmed === '/') {
    return '';
  }

  return trimmed.replace(/^\/+/, '').replace(/\/+/g, '/');
}

function toRelativeWorkspacePath(workspacePath: string, absolutePath: string): string {
  return path.relative(workspacePath, absolutePath).split(path.sep).join('/');
}

function compareDirents(
  left: { isDirectory(): boolean; name: string },
  right: { isDirectory(): boolean; name: string },
): number {
  if (left.isDirectory() !== right.isDirectory()) {
    return left.isDirectory() ? -1 : 1;
  }

  return left.name.localeCompare(right.name, 'zh-Hans-CN');
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 2048);

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }

  return false;
}

function mapGitStatusRow(row: StatusRow): GitStatusEntry | null {
  const [filepath, headStatus, workdirStatus, stageStatus] = row;

  if (headStatus === workdirStatus && workdirStatus === stageStatus) {
    return null;
  }

  let indexStatus = '';
  let worktreeStatus = '';

  if (headStatus === 0 && stageStatus === 0 && workdirStatus !== 0) {
    return { path: filepath, renameFrom: null, status: '??' };
  }

  if (headStatus === 0 && stageStatus !== 0) {
    indexStatus = 'A';
  } else if (headStatus !== 0 && stageStatus === 0) {
    indexStatus = 'D';
  } else if (headStatus !== stageStatus) {
    indexStatus = 'M';
  }

  if (stageStatus !== 0 && workdirStatus === 0) {
    worktreeStatus = 'D';
  } else if (stageStatus === 0 && workdirStatus !== 0) {
    worktreeStatus = '?';
  } else if (stageStatus !== workdirStatus) {
    worktreeStatus = 'M';
  }

  return {
    path: filepath,
    renameFrom: null,
    status: `${indexStatus}${worktreeStatus}` || 'M',
  };
}

function isPathOnRoute(filepath: string, targetPath: string): boolean {
  return (
    filepath === '.' ||
    filepath === targetPath ||
    targetPath.startsWith(`${filepath}/`)
  );
}

function sanitizeDiffPath(filepath: string): string {
  return filepath.replace(/[\u0000-\u001f\u007f]/gu, '�');
}

function renderGitUnavailableReason(error: unknown): string {
  return error instanceof DomainError
    ? error.message
    : 'Workspace Git metadata could not be read safely';
}

function isProtectedRelativePath(relativePath: string, isDirectory: boolean): boolean {
  const normalized = normalizeRelativePath(relativePath);

  if (!normalized) {
    return false;
  }

  const segments = normalized.split('/').filter(Boolean);
  const normalizedSegments = segments.map((segment) => segment.toLowerCase());
  const basename = normalizedSegments[normalizedSegments.length - 1] ?? '';

  if (normalizedSegments[0] === '.git') {
    return true;
  }

  const protectedDirectories = new Set([
    '.aws',
    '.azure',
    '.docker',
    '.gnupg',
    '.kube',
    '.ssh',
  ]);

  if (normalizedSegments.some((segment) => protectedDirectories.has(segment))) {
    return true;
  }

  if (isDirectory) {
    return false;
  }

  if (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    basename === '.npmrc' ||
    basename === '.pypirc' ||
    basename === '.netrc' ||
    basename === 'credentials' ||
    basename === 'credentials.json' ||
    basename === 'kubeconfig' ||
    basename === 'secrets.json' ||
    basename === 'secrets.yaml' ||
    basename === 'secrets.yml' ||
    basename === 'token' ||
    basename === 'token.json' ||
    basename === 'token.txt' ||
    /^service[-_]account.*\.json$/u.test(basename) ||
    basename === 'id_rsa' ||
    basename === 'id_ed25519' ||
    basename.endsWith('.db') ||
    basename.endsWith('.sqlite') ||
    basename.endsWith('.sqlite3') ||
    basename.endsWith('.pem') ||
    basename.endsWith('.key') ||
    basename.endsWith('.p12') ||
    basename.endsWith('.pfx')
  ) {
    return true;
  }

  return false;
}
