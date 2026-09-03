import type { Logger } from 'pino';

import type { AppConfig } from '../config/env.js';
import { AGENT_TYPES, type AgentType } from '../domain/agent.js';
import type { AgentRuntimeRecord } from '../domain/butler.js';
import { runCommand } from '../infra/process/command-runner.js';
import { extractCommandBinary, shellQuote } from '../utils/runtime-command.js';

type AgentRuntimeServiceOptions = {
  config: Pick<AppConfig, 'claudeBin' | 'codexBin' | 'geminiBin'>;
  logger: Logger;
  supportedAgentTypes: AgentType[];
};

const RUNTIME_TITLES: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
};

export class AgentRuntimeService {
  constructor(private readonly options: AgentRuntimeServiceOptions) {}

  async listRuntimes(
    sessionCounts: Partial<Record<AgentType, number>> = {},
  ): Promise<AgentRuntimeRecord[]> {
    const runtimes = await Promise.all(
      AGENT_TYPES.map(async (agentType) => {
        const command = this.getConfiguredCommand(agentType);
        const detection = await this.detectRuntime(command);
        const sessionCount = sessionCounts[agentType] ?? 0;

        return {
          agentType,
          binary: detection.binary,
          command,
          detectedPath: detection.detectedPath,
          installed: detection.installed,
          sessionCount,
          spawnSupported: this.options.supportedAgentTypes.includes(agentType),
          status: detection.installed ? 'available' : 'missing',
          summary: detection.installed
            ? `${RUNTIME_TITLES[agentType]} 可用 · ${sessionCount} 个会话`
            : `${RUNTIME_TITLES[agentType]} 未安装或未在 PATH 中`,
          title: RUNTIME_TITLES[agentType],
        } satisfies AgentRuntimeRecord;
      }),
    );

    this.options.logger.debug({ runtimes }, 'agent runtimes resolved');
    return runtimes;
  }

  getConfiguredCommand(agentType: AgentType): string {
    switch (agentType) {
      case 'codex':
        return this.options.config.codexBin;
      case 'claude-code':
        return this.options.config.claudeBin;
      case 'gemini':
        return this.options.config.geminiBin;
    }
  }

  async getInstalledAgentTypes(): Promise<AgentType[]> {
    const runtimes = await this.listRuntimes();
    return runtimes.filter((runtime) => runtime.installed).map((runtime) => runtime.agentType);
  }

  private async detectRuntime(commandLine: string): Promise<{
    binary: string | null;
    detectedPath: string | null;
    installed: boolean;
  }> {
    const binary = extractCommandBinary(commandLine);

    if (!binary) {
      return {
        binary: null,
        detectedPath: null,
        installed: false,
      };
    }

    const result = await runCommand(
      '/bin/sh',
      ['-lc', `command -v ${shellQuote(binary)}`],
      { allowNonZero: true },
    );

    return {
      binary,
      detectedPath: result.exitCode === 0 ? result.stdout.trim() || binary : null,
      installed: result.exitCode === 0,
    };
  }
}
