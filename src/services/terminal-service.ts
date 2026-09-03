import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type { Logger } from 'pino';

import type { ApprovalRiskLevel } from '../domain/approval.js';
import { DomainError, NotFoundError } from '../domain/errors.js';
import type { TerminalCommandRecord, TerminalRiskAssessment } from '../domain/terminal.js';
import type { TerminalCommandRepository } from '../infra/repositories/terminal-command-repository.js';
import { ConversationService } from './conversation-service.js';
import { SessionEventBus } from './session-event-bus.js';
import { SessionService } from './session-service.js';

type TerminalServiceOptions = {
  commandTimeoutMs: number;
  conversationService: ConversationService;
  logger: Logger;
  maxOutputCharacters: number;
  repository: TerminalCommandRepository;
  sessionEventBus: SessionEventBus;
  sessionService: SessionService;
};

type ActiveCommandState = {
  cancelled: boolean;
  child: ChildProcess;
};

export class TerminalService {
  private readonly activeCommands = new Map<number, ActiveCommandState>();

  constructor(private readonly options: TerminalServiceOptions) {}

  assessCommandRisk(command: string): TerminalRiskAssessment {
    const normalized = command.trim().toLowerCase();

    if (!normalized) {
      return {
        reason: '空命令不会执行',
        requiresApproval: true,
        riskLevel: 'high',
      };
    }

    // Keep the original command here.  `trim()` would otherwise hide a trailing
    // newline, which is a shell command separator when the command is later
    // passed to `shell -lc`.
    if (isReadOnlyTerminalCommand(command)) {
      return {
        reason: '只读命令，可直接执行',
        requiresApproval: false,
        riskLevel: 'low',
      };
    }

    if (isHighRiskTerminalCommand(normalized)) {
      return {
        reason: '命令可能修改文件、仓库或系统状态，需要显式审批',
        requiresApproval: true,
        riskLevel: 'high',
      };
    }

    return {
      reason: '命令不是只读操作，按保守策略进入审批',
      requiresApproval: true,
      riskLevel: 'medium',
    };
  }

  async listCommands(sessionName: string, limit = 20): Promise<TerminalCommandRecord[]> {
    const session = await this.options.sessionService.requireByName(sessionName);
    return this.options.repository.findBySessionId(session.id, limit);
  }

  async getCommand(id: number): Promise<TerminalCommandRecord> {
    const command = await this.options.repository.findById(id);

    if (!command) {
      throw new NotFoundError(`Terminal command "${id}" was not found`);
    }

    return command;
  }

  async startCommand(input: {
    actorId: string;
    approvalRequestId?: number | null;
    command: string;
    sessionName: string;
  }): Promise<TerminalCommandRecord> {
    const session = await this.options.sessionService.requireByName(input.sessionName);
    const record = await this.options.repository.create({
      approvalRequestId: input.approvalRequestId ?? null,
      command: input.command,
      createdBy: input.actorId,
      cwd: session.workspacePath,
      sessionId: session.id,
      sessionName: session.name,
    });

    await this.options.conversationService.recordEvent({
      actorId: input.actorId,
      eventType: 'terminal.command.queued',
      payload: {
        approvalRequestId: input.approvalRequestId ?? null,
        command: input.command,
        commandId: record.id,
      },
      sessionId: session.id,
      sessionName: session.name,
    });

    void this.execute(record).catch((error: unknown) => {
      this.options.logger.error(
        { commandId: record.id, err: error },
        'terminal command execution failed unexpectedly',
      );
    });
    return record;
  }

  async cancelCommand(id: number, actorId: string): Promise<TerminalCommandRecord> {
    const command = await this.getCommand(id);
    const active = this.activeCommands.get(id);

    if (!active) {
      throw new DomainError(`Terminal command "${id}" is not currently running`);
    }

    active.cancelled = true;
    active.child.kill('SIGTERM');
    await this.options.conversationService.recordEvent({
      actorId,
      eventType: 'terminal.command.cancelled',
      payload: {
        commandId: id,
      },
      sessionId: command.sessionId,
      sessionName: command.sessionName,
    });

    return command;
  }

  private async execute(record: TerminalCommandRecord): Promise<void> {
    let running: TerminalCommandRecord;

    try {
      running = await this.options.repository.markRunning(record.id);
    } catch (error) {
      await this.failCommandBeforeStart(record, error);
      return;
    }

    let child: ChildProcess;

    try {
      const directTokens = isReadOnlyTerminalCommand(running.command)
        ? parseSafeShellWords(running.command)
        : null;
      const spawnOptions = {
        cwd: running.cwd,
        env: directTokens ? directCommandEnvironment() : process.env,
        stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
        shell: false,
      };

      if (directTokens) {
        child = spawn(
          resolveDirectExecutable(directTokens[0]!),
          directTokens.slice(1),
          spawnOptions,
        );
      } else {
        child = spawn(
          process.env.SHELL?.trim() || '/bin/bash',
          ['-lc', running.command],
          spawnOptions,
        );
      }
    } catch (error) {
      await this.failCommandBeforeStart(running, error);
      return;
    }

    const activeState: ActiveCommandState = {
      cancelled: false,
      child,
    };
    this.activeCommands.set(running.id, activeState);

    let stdoutTail = '';
    let stderrTail = '';
    let timedOut = false;
    let finalized = false;
    let timeout: NodeJS.Timeout | null = null;

    const finalize = (
      status: 'cancelled' | 'failed' | 'succeeded',
      exitCode: number | null,
    ): void => {
      if (finalized) {
        return;
      }

      finalized = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      this.activeCommands.delete(running.id);
      void this.completeCommand(running, status, exitCode, stdoutTail, stderrTail).catch(
        (error: unknown) => {
          this.options.logger.error(
            { commandId: running.id, err: error },
            'terminal command completion failed',
          );
        },
      );
    };

    const flushOutput = async (stream: 'stdout' | 'stderr', chunk: Buffer): Promise<void> => {
      const text = chunk.toString();

      if (stream === 'stdout') {
        stdoutTail = appendTail(stdoutTail, text, this.options.maxOutputCharacters);
      } else {
        stderrTail = appendTail(stderrTail, text, this.options.maxOutputCharacters);
      }

      await this.options.repository.updateOutput(running.id, stdoutTail, stderrTail);
      this.options.sessionEventBus.publish({
        actorId: running.createdBy,
        eventType: 'terminal.output',
        payload: {
          chunk: text,
          command: running.command,
          commandId: running.id,
          stream,
        },
        sessionId: running.sessionId,
        sessionName: running.sessionName,
      });
    };

    const stdout = child.stdout;
    const stderr = child.stderr;

    if (!stdout || !stderr) {
      child.kill('SIGTERM');
      stderrTail = 'Command streams unavailable';
      finalize('failed', -1);
      return;
    }

    stdout.on('data', (chunk) => {
      void flushOutput('stdout', Buffer.from(chunk)).catch((error: unknown) => {
        this.options.logger.error(
          { commandId: running.id, err: error },
          'terminal stdout persistence failed',
        );
      });
    });

    stderr.on('data', (chunk) => {
      void flushOutput('stderr', Buffer.from(chunk)).catch((error: unknown) => {
        this.options.logger.error(
          { commandId: running.id, err: error },
          'terminal stderr persistence failed',
        );
      });
    });

    child.on('error', (error) => {
      stderrTail = appendTail(stderrTail, error.message, this.options.maxOutputCharacters);
      finalize('failed', -1);
    });

    timeout = setTimeout(() => {
      timedOut = true;
      activeState.child.kill('SIGTERM');
      setTimeout(() => {
        if (this.activeCommands.has(running.id)) {
          activeState.child.kill('SIGKILL');
        }
      }, 1500);
    }, this.options.commandTimeoutMs);

    child.on('close', (code) => {
      const wasCancelled = activeState.cancelled;

      if (timedOut) {
        stderrTail = appendTail(
          stderrTail,
          `\nCommand timed out after ${this.options.commandTimeoutMs}ms`,
          this.options.maxOutputCharacters,
        );
      }

      const status = wasCancelled
        ? 'cancelled'
        : timedOut || (code ?? 0) !== 0
          ? 'failed'
          : 'succeeded';
      const exitCode = wasCancelled ? null : code ?? (timedOut ? -1 : 0);

      finalize(status, exitCode);
    });
  }

  private async failCommandBeforeStart(
    record: TerminalCommandRecord,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : 'Command failed to start';
    const stderrTail = appendTail('', message, this.options.maxOutputCharacters);

    try {
      await this.completeCommand(record, 'failed', -1, '', stderrTail);
    } catch (completionError) {
      this.options.logger.error(
        { commandId: record.id, err: completionError, startError: error },
        'terminal command could not be started or marked failed',
      );
    }
  }

  private async completeCommand(
    record: TerminalCommandRecord,
    status: 'cancelled' | 'failed' | 'succeeded',
    exitCode: number | null,
    stdoutTail: string,
    stderrTail: string,
  ): Promise<void> {
    const completed = await this.options.repository.complete({
      exitCode,
      id: record.id,
      status,
      stderrTail,
      stdoutTail,
    });

    await this.options.conversationService.createMessage({
      actorId: record.createdBy,
      content: renderTerminalSummary(completed),
      metadata: {
        action: 'terminal.command.completed',
        command: completed.command,
        commandId: completed.id,
        exitCode: completed.exitCode,
        status: completed.status,
      },
      role: 'tool',
      sessionId: completed.sessionId,
      sessionName: completed.sessionName,
      source: 'terminal-service',
    });
    await this.options.conversationService.recordEvent({
      actorId: record.createdBy,
      eventType: 'terminal.command.completed',
      payload: {
        command: completed.command,
        commandId: completed.id,
        exitCode: completed.exitCode,
        status: completed.status,
      },
      sessionId: completed.sessionId,
      sessionName: completed.sessionName,
    });
    this.options.logger.info({ commandId: completed.id, status: completed.status }, 'terminal command completed');
  }
}

function appendTail(current: string, addition: string, maxCharacters: number): string {
  const combined = `${current}${addition}`;
  return combined.length > maxCharacters
    ? combined.slice(combined.length - maxCharacters)
    : combined;
}

export function isReadOnlyTerminalCommand(command: string): boolean {
  const tokens = parseSafeShellWords(command);

  if (!tokens || tokens.length === 0) {
    return false;
  }

  // Unix executable names are case-sensitive. Do not classify `PWD` or
  // `UNAME` as trusted and then resolve a different on-disk name.
  const executable = tokens[0]!;
  const args = tokens.slice(1);

  if (
    args.some(
      (argument) => isSensitiveReadPath(argument) || isUnsafeDirectPath(argument),
    )
  ) {
    return false;
  }

  if (READ_ONLY_COMMANDS.has(executable)) {
    return isReadOnlyCommandArguments(executable, args);
  }

  return false;
}

/**
 * Commands in this set are eligible for direct argv execution once the shell
 * syntax check has passed.  The syntax check must happen before this allowlist
 * is consulted because approved, non-read-only commands still use a shell.
 */
const READ_ONLY_COMMANDS = new Set([
  'hostname',
  'uname',
  'uptime',
  'pwd',
  'df',
]);

const DIRECT_EXECUTABLE_DIRECTORIES = ['/bin', '/usr/bin', '/sbin', '/usr/sbin'];

const DIRECT_COMMAND_ENV_ALLOWLIST = new Set([
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'USER',
]);

function directCommandEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of DIRECT_COMMAND_ENV_ALLOWLIST) {
    const value = process.env[key];

    if (value !== undefined) {
      environment[key] = value;
    }
  }

  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_PAGER = 'cat';
  environment.LESSSECURE = '1';
  environment.PAGER = 'cat';
  environment.SYSTEMD_PAGER = 'cat';
  environment.SYSTEMD_PAGERSECURE = '1';
  return environment;
}

function resolveDirectExecutable(executable: string): string {
  if (!/^[a-z0-9._-]+$/iu.test(executable)) {
    throw new DomainError(`Direct command executable is invalid: ${executable}`);
  }

  for (const directory of DIRECT_EXECUTABLE_DIRECTORIES) {
    const candidate = path.join(directory, executable);

    if (!existsSync(candidate)) {
      continue;
    }

    const resolved = realpathSync(candidate);
    const contained = DIRECT_EXECUTABLE_DIRECTORIES.some(
      (allowedDirectory) =>
        resolved === allowedDirectory || resolved.startsWith(`${allowedDirectory}${path.sep}`),
    );

    if (contained) {
      return resolved;
    }
  }

  throw new DomainError(`Direct command executable is unavailable: ${executable}`);
}

function isReadOnlyCommandArguments(executable: string, args: string[]): boolean {
  if (['uptime', 'pwd', 'df'].includes(executable)) {
    return args.length === 0;
  }

  if (executable === 'uname') {
    const readOnlyUnameOptions = new Set([
      '-a',
      '-s',
      '-n',
      '-r',
      '-v',
      '-m',
      '-p',
      '-i',
      '-o',
      '--all',
      '--kernel-name',
      '--nodename',
      '--kernel-release',
      '--kernel-version',
      '--machine',
      '--processor',
      '--hardware-platform',
      '--operating-system',
    ]);
    return args.every((argument) => readOnlyUnameOptions.has(argument));
  }

  if (executable === 'hostname') {
    // `hostname <name>` and `hostname --file <path>` change the machine name.
    // Permit only the well-known query flags; unknown flags require approval.
    const readOnlyHostnameOptions = new Set([
      '-a',
      '-d',
      '-f',
      '-i',
      '-s',
      '-A',
      '-I',
      '--alias',
      '--all-fqdn',
      '--all-ip-addresses',
      '--domain',
      '--fqdn',
      '--ip-address',
      '--short',
    ]);
    return args.every((argument) => readOnlyHostnameOptions.has(argument));
  }

  return true;
}

/**
 * Parse only the small subset of shell words accepted for direct execution.
 * Any shell operator, expansion, control character, or escape causes the
 * command to require approval.  In particular, do not rely on a prefix check:
 * `ls ; rm -rf ...` starts with a read-only command but is still a compound
 * shell command.
 */
function parseSafeShellWords(command: string): string[] | null {
  if (!command || hasUnsafeShellSyntax(command)) {
    return null;
  }

  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let wordStarted = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      wordStarted = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      wordStarted = true;
      continue;
    }

    if (char === ' ' || char === '\t') {
      if (wordStarted) {
        words.push(current);
        current = '';
        wordStarted = false;
      }
      continue;
    }

    current += char;
    wordStarted = true;
  }

  if (quote) {
    return null;
  }

  if (wordStarted) {
    words.push(current);
  }

  return words;
}

function hasUnsafeShellSyntax(command: string): boolean {
  // These characters are shell operators or can introduce an expansion/escape
  // that changes the command after classification. We reject them even inside
  // quotes; this is intentionally conservative because approved commands are
  // ultimately interpreted by a shell.
  const unsafeCharacters = new Set([
    ';',
    '&',
    '|',
    '<',
    '>',
    '`',
    '$',
    '(',
    ')',
    '\\',
    '\n',
    '\r',
  ]);
  const expansionCharacters = new Set(['!', '#', '*', '?', '[', ']', '{', '}', '~']);
  let quote: '"' | "'" | null = null;

  for (const char of command) {
    if (unsafeCharacters.has(char)) {
      return true;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    // Globs, brace expansion, tilde expansion, and comments are not needed by
    // the direct-read path.  Reject them when unquoted; quoted patterns such
    // as `rg --glob '*.ts'` remain usable because the shell treats them as
    // literal arguments.
    if (expansionCharacters.has(char)) {
      return true;
    }

    const codePoint = char.codePointAt(0) ?? 0;
    // Reject other control characters (including NUL and vertical whitespace).
    // Horizontal tab is a normal shell word separator and is handled by the
    // parser above.
    if ((codePoint < 0x20 && char !== '\t') || codePoint === 0x7f) {
      return true;
    }
  }

  return false;
}

function isSensitiveReadPath(argument: string): boolean {
  const normalized = argument.toLowerCase();
  const objectPath = normalized.includes(':')
    ? normalized.slice(normalized.lastIndexOf(':') + 1)
    : normalized;
  const basename = objectPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? objectPath;

  // Git object paths such as HEAD:.env are normalized to their path component.
  return (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    basename === '.npmrc' ||
    basename === '.pypirc' ||
    basename === '.netrc' ||
    basename === '.git-credentials' ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/u.test(basename) ||
    /(?:secret|credential|password|private[._-]?key)/u.test(basename) ||
    /\.(?:pem|key|p12|pfx)$/u.test(basename) ||
    normalized === '/etc/shadow' ||
    normalized === '/etc/gshadow'
  );
}

function isUnsafeDirectPath(argument: string): boolean {
  const candidates = [argument];
  const equalIndex = argument.indexOf('=');
  const colonIndex = argument.lastIndexOf(':');

  if (equalIndex >= 0) {
    candidates.push(argument.slice(equalIndex + 1));
  }

  if (colonIndex >= 0) {
    candidates.push(argument.slice(colonIndex + 1));
  }

  return candidates.some((candidate) => {
    const normalized = candidate.trim().replace(/\\/gu, '/').toLowerCase();
    const segments = normalized.split('/').filter(Boolean);

    return (
      normalized.startsWith('/') ||
      /^[a-z]:\//u.test(normalized) ||
      segments.includes('..') ||
      segments.includes('.git') ||
      segments.includes('.ssh') ||
      (segments.includes('proc') && segments.at(-1) === 'environ')
    );
  });
}

export function isHighRiskTerminalCommand(command: string): boolean {
  const patterns = [
    /\brm\b/u,
    /\bmv\b/u,
    /\bchmod\b/u,
    /\bchown\b/u,
    /\bsudo\b/u,
    /\bgit\s+(reset|clean|restore|checkout\s+--|push)\b/u,
    /\bnpm\s+publish\b/u,
    /\bpnpm\s+publish\b/u,
    /\byarn\s+publish\b/u,
    /\bbrew\b/u,
    /\bdocker\b/u,
    /\bkubectl\b/u,
    />{1,2}/u,
    /\btee\b/u,
    /\bcurl\b.*\|\s*(sh|bash|zsh)/u,
    /\bwget\b.*\|\s*(sh|bash|zsh)/u,
  ];

  return patterns.some((pattern) => pattern.test(command));
}

function renderTerminalSummary(record: TerminalCommandRecord): string {
  const lines = [
    `终端命令：${record.command}`,
    `状态：${record.status}`,
    `目录：${record.cwd}`,
  ];

  if (record.exitCode !== null) {
    lines.push(`退出码：${record.exitCode}`);
  }

  if (record.stdoutTail.trim()) {
    lines.push('', 'stdout:', record.stdoutTail);
  }

  if (record.stderrTail.trim()) {
    lines.push('', 'stderr:', record.stderrTail);
  }

  return lines.join('\n');
}

export function approvalRiskLabel(riskLevel: ApprovalRiskLevel): string {
  if (riskLevel === 'high') {
    return '高风险';
  }

  if (riskLevel === 'medium') {
    return '中风险';
  }

  return '低风险';
}
