import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from 'pino';

import type { AppConfig } from '../config/env.js';
import type {
  ManagedServerDoctorResult,
  ManagedServerRecord,
  ManagedServiceCommandResult,
  ManagedServiceLiveStatus,
  ManagedServiceLogs,
  ManagedServiceRecord,
  ManagedServiceStatus,
  ServerManagerIntegrationStatus,
} from '../domain/butler.js';
import { DomainError, NotFoundError } from '../domain/errors.js';
import { runCommand } from '../infra/process/command-runner.js';

const MAX_SERVER_MANAGER_OUTPUT_CHARACTERS = 64_000;

type ServerManagerServiceOptions = {
  configPath: string;
  logger: Logger;
  pythonBin: string;
  repoPath: string;
};

type RawServerManagerConfig = {
  servers?: Record<string, RawServerConfig>;
};

type RawServerConfig = {
  description?: string;
  host?: string;
  port?: number;
  projects?: Record<string, RawProjectConfig>;
  tags?: string[];
};

type RawProjectConfig = {
  description?: string;
  frp_remote_port?: number;
  health_check_url?: string;
  log_file?: string;
  port?: number;
  remote_path?: string;
};

export class ServerManagerService {
  private readonly statusCache = new Map<string, ManagedServiceLiveStatus>();

  constructor(private readonly options: ServerManagerServiceOptions) {}

  async getIntegrationStatus(): Promise<ServerManagerIntegrationStatus> {
    try {
      await this.loadConfig();
      return {
        available: true,
        configPath: this.options.configPath,
        reason: null,
        repoPath: this.options.repoPath,
      };
    } catch (error) {
      return {
        available: false,
        configPath: this.options.configPath,
        reason: error instanceof Error ? error.message : 'server-manager unavailable',
        repoPath: this.options.repoPath,
      };
    }
  }

  async listManagedServers(): Promise<ManagedServerRecord[]> {
    const config = await this.loadConfig();
    const servers = config.servers ?? {};

    return Object.entries(servers).map(([serverName, serverConfig]) => {
      const host = serverConfig.host?.trim() || 'unknown';
      const sshPort = Number.isFinite(serverConfig.port) ? Number(serverConfig.port) : 22;
      const projects = Object.entries(serverConfig.projects ?? {}).map(([projectName, project]) =>
        this.mapProject(serverName, host, sshPort, serverConfig.tags ?? [], projectName, project),
      );

      return {
        configPath: this.options.configPath,
        description: serverConfig.description?.trim() || null,
        host,
        name: serverName,
        port: sshPort,
        projects,
        repoPath: this.options.repoPath,
        tags: serverConfig.tags ?? [],
      } satisfies ManagedServerRecord;
    });
  }

  async getServiceStatus(
    serverName: string,
    projectName: string,
  ): Promise<ManagedServiceLiveStatus> {
    await this.requireProject(serverName, projectName);

    const result = await this.runCli(
      ['-s', serverName, '-p', projectName, 'status'],
      true,
    );
    const rawOutput = sanitizeCliOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
    const parsed = classifyServiceStatus(rawOutput);
    const liveStatus = {
      checkedAt: new Date().toISOString(),
      projectName,
      rawOutput,
      serverName,
      status: parsed.status,
      summary: parsed.summary,
    } satisfies ManagedServiceLiveStatus;

    this.statusCache.set(this.cacheKey(serverName, projectName), liveStatus);
    return liveStatus;
  }

  async getServiceLogs(
    serverName: string,
    projectName: string,
    lines = 120,
  ): Promise<ManagedServiceLogs> {
    await this.requireProject(serverName, projectName);
    const result = await this.runCli(
      ['-s', serverName, '-p', projectName, 'logs', '-n', String(lines)],
      true,
    );

    return {
      content: sanitizeCliOutput([result.stdout, result.stderr].filter(Boolean).join('\n')),
      fetchedAt: new Date().toISOString(),
      lines,
      projectName,
      serverName,
    };
  }

  async doctorServer(serverName: string): Promise<ManagedServerDoctorResult> {
    await this.requireServer(serverName);
    const result = await this.runCli(['-s', serverName, 'doctor'], true);
    const rawOutput = sanitizeCliOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
    const ok = !containsConnectionFailure(rawOutput);

    return {
      checkedAt: new Date().toISOString(),
      ok,
      rawOutput,
      serverName,
      summary: ok ? '连通性检查已完成' : '连通性检查发现异常',
    };
  }

  async runServiceAction(
    action: 'restart' | 'start' | 'stop',
    serverName: string,
    projectName: string,
  ): Promise<ManagedServiceCommandResult> {
    await this.requireProject(serverName, projectName);
    const result = await this.runCli(['-s', serverName, '-p', projectName, action], true);
    this.statusCache.delete(this.cacheKey(serverName, projectName));

    return {
      executedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      projectName,
      rawOutput: sanitizeCliOutput([result.stdout, result.stderr].filter(Boolean).join('\n')),
      serverName,
      summary: `已提交 ${action} 动作`,
    };
  }

  async executeProjectCommand(
    serverName: string,
    projectName: string,
    command: string,
  ): Promise<ManagedServiceCommandResult> {
    if (!command.trim()) {
      throw new DomainError('Remote command must be a non-empty string');
    }

    await this.requireProject(serverName, projectName);
    const result = await this.runCli(
      ['-s', serverName, '-p', projectName, 'exec', command],
      true,
    );

    return {
      executedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      projectName,
      rawOutput: sanitizeCliOutput([result.stdout, result.stderr].filter(Boolean).join('\n')),
      serverName,
      summary: '远程命令已执行',
    };
  }

  private async loadConfig(): Promise<RawServerManagerConfig> {
    const raw = await readFile(this.options.configPath, 'utf8');
    return JSON.parse(raw) as RawServerManagerConfig;
  }

  private async requireServer(serverName: string): Promise<RawServerConfig> {
    const config = await this.loadConfig();
    const server = config.servers?.[serverName];

    if (!server) {
      throw new NotFoundError(`Managed server "${serverName}" was not found`);
    }

    return server;
  }

  private async requireProject(
    serverName: string,
    projectName: string,
  ): Promise<RawProjectConfig> {
    const server = await this.requireServer(serverName);
    const project = server.projects?.[projectName];

    if (!project) {
      throw new NotFoundError(
        `Managed service "${serverName}/${projectName}" was not found`,
      );
    }

    return project;
  }

  private mapProject(
    serverName: string,
    host: string,
    sshPort: number,
    tags: string[],
    projectName: string,
    project: RawProjectConfig,
  ): ManagedServiceRecord {
    return {
      actions: ['status', 'logs', 'start', 'stop', 'restart', 'exec'],
      description: project.description?.trim() || null,
      frpRemotePort: Number.isFinite(project.frp_remote_port)
        ? Number(project.frp_remote_port)
        : null,
      healthCheckUrl: project.health_check_url?.trim() || null,
      host,
      id: `${serverName}:${projectName}`,
      lastStatus: this.statusCache.get(this.cacheKey(serverName, projectName)) ?? null,
      logFile: project.log_file?.trim() || null,
      name: projectName,
      port: Number.isFinite(project.port) ? Number(project.port) : null,
      projectName,
      remotePath: project.remote_path?.trim() || null,
      serverName,
      sshPort,
      tags,
    };
  }

  private async runCli(args: string[], allowNonZero = false) {
    return runCommand(
      this.options.pythonBin,
      [
        path.join(this.options.repoPath, 'multi_server_manager.py'),
        '-c',
        this.options.configPath,
        ...args,
      ],
      {
        allowNonZero,
        cwd: this.options.repoPath,
        maxOutputCharacters: MAX_SERVER_MANAGER_OUTPUT_CHARACTERS,
      },
    );
  }

  private cacheKey(serverName: string, projectName: string): string {
    return `${serverName}:${projectName}`;
  }
}

function sanitizeCliOutput(value: string): string {
  return value
    .replace(/\u001B\[[0-9;?]*[A-Za-z]/gu, '')
    .replace(/\r\n/gu, '\n')
    .trim();
}

function classifyServiceStatus(
  output: string,
): { status: ManagedServiceStatus; summary: string } {
  if (!output.trim()) {
    return {
      status: 'unknown',
      summary: '服务状态尚未返回',
    };
  }

  if (containsConnectionFailure(output)) {
    return {
      status: 'connection_failed',
      summary: 'SSH 或网络连通失败',
    };
  }

  if (output.toLowerCase().includes('not running') || output.includes('未运行')) {
    return {
      status: 'stopped',
      summary: '服务未运行',
    };
  }

  if (output.includes('运行中')) {
    return {
      status: 'running',
      summary: '服务运行中',
    };
  }

  if (/\bfailed\b/iu.test(output) || output.includes('错误')) {
    return {
      status: 'error',
      summary: '命令执行异常',
    };
  }

  return {
    status: 'configured',
    summary: firstMeaningfulLine(output) ?? '服务已配置，等待检查',
  };
}

function containsConnectionFailure(output: string): boolean {
  const normalized = output.toLowerCase();
  return [
    '连接失败',
    'timed out',
    'connection refused',
    'permission denied',
    'no route to host',
    'network is unreachable',
  ].some((marker) => normalized.includes(marker));
}

function firstMeaningfulLine(output: string): string | null {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] ?? null;
}
