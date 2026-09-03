import type { Logger } from 'pino';

import type { AgentType } from '../../domain/agent.js';
import { DependencyError } from '../../domain/errors.js';
import { runCommand } from '../process/command-runner.js';
import { extractCommandBinary, shellQuote } from '../../utils/runtime-command.js';

const TRUST_PROMPT_MARKERS = [
  'Do you trust the contents of this directory?',
  'Press enter to continue',
];

type TmuxManagerOptions = {
  autoConfirmWorkspaceTrust: boolean;
  hubSessionName: string;
  logger: Logger;
  runtimeCommands: Record<AgentType, string>;
};

export class TmuxManager {
  constructor(private readonly options: TmuxManagerOptions) {}

  async capture(windowName: string, lines: number): Promise<string> {
    await this.ensureTmuxInstalled();
    const result = await runCommand('tmux', [
      'capture-pane',
      '-t',
      this.windowTarget(windowName),
      '-p',
      '-S',
      `-${lines}`,
    ]);
    return sanitizeTmuxOutput(result.stdout);
  }

  async createAgentWindow(
    agentType: AgentType,
    windowName: string,
    workspacePath: string,
  ): Promise<void> {
    await this.ensureTmuxInstalled();
    await this.ensureAgentRuntimeInstalled(agentType);
    const windowExists = await this.hasWindow(windowName);

    if (windowExists) {
      throw new DependencyError(`tmux window "${windowName}" already exists`);
    }

    const hubExists = await this.hasHubSession();

    if (hubExists) {
      await runCommand('tmux', [
        'new-window',
        '-d',
        '-t',
        this.options.hubSessionName,
        '-n',
        windowName,
        '-c',
        workspacePath,
      ]);
    } else {
      await runCommand('tmux', [
        'new-session',
        '-d',
        '-s',
        this.options.hubSessionName,
        '-n',
        windowName,
        '-c',
        workspacePath,
      ]);
    }

    await this.sendLiteral(windowName, this.buildStartupCommand(agentType));
    await this.sendEnter(windowName);
    if (this.options.autoConfirmWorkspaceTrust) {
      await this.autoConfirmWorkspaceTrust(windowName);
    }
  }

  async hasHubSession(): Promise<boolean> {
    await this.ensureTmuxInstalled();
    const result = await runCommand(
      'tmux',
      ['has-session', '-t', this.options.hubSessionName],
      { allowNonZero: true },
    );
    return result.exitCode === 0;
  }

  async hasWindow(windowName: string): Promise<boolean> {
    await this.ensureTmuxInstalled();
    const result = await runCommand(
      'tmux',
      ['list-windows', '-t', this.options.hubSessionName, '-F', '#W'],
      { allowNonZero: true },
    );

    if (result.exitCode !== 0) {
      return false;
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .includes(windowName);
  }

  async killWindow(windowName: string): Promise<void> {
    await this.ensureTmuxInstalled();
    await runCommand('tmux', ['kill-window', '-t', this.windowTarget(windowName)]);
  }

  async renameWindow(currentWindowName: string, nextWindowName: string): Promise<void> {
    await this.ensureTmuxInstalled();
    await runCommand('tmux', [
      'rename-window',
      '-t',
      this.windowTarget(currentWindowName),
      nextWindowName,
    ]);
  }

  async sendPrompt(windowName: string, prompt: string): Promise<void> {
    await this.ensureTmuxInstalled();
    await this.sendLiteral(windowName, prompt);
    await this.sendEnter(windowName);
  }

  getHubSessionName(): string {
    return this.options.hubSessionName;
  }

  sanitizeWindowName(input: string): string {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }

  private async ensureTmuxInstalled(): Promise<void> {
    const result = await runCommand('tmux', ['-V'], { allowNonZero: true }).catch(
      (error) => {
        throw new DependencyError(
          `tmux is required but unavailable. Install it first, for example: brew install tmux. ${error instanceof Error ? error.message : ''}`.trim(),
        );
      },
    );

    if (result.exitCode !== 0) {
      throw new DependencyError('tmux is installed but unavailable to execute.');
    }
  }

  private async autoConfirmWorkspaceTrust(windowName: string): Promise<void> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await sleep(250);
      const output = await this.safeCapture(windowName, 80);

      if (!output) {
        continue;
      }

      if (containsTrustPrompt(output)) {
        this.options.logger.info(
          { windowName },
          'workspace trust prompt detected, confirming automatically',
        );
        await this.sendEnter(windowName);
        await sleep(300);
        return;
      }
    }
  }

  private buildStartupCommand(agentType: AgentType): string {
    const configuredCommand = this.options.runtimeCommands[agentType]?.trim();

    if (!configuredCommand) {
      throw new DependencyError(`No runtime command configured for agent "${agentType}"`);
    }

    if (agentType === 'codex' && !configuredCommand.includes('--no-alt-screen')) {
      return `${configuredCommand} --no-alt-screen`;
    }

    return configuredCommand;
  }

  private async ensureAgentRuntimeInstalled(agentType: AgentType): Promise<void> {
    const configuredCommand = this.options.runtimeCommands[agentType]?.trim();

    if (!configuredCommand) {
      throw new DependencyError(`No runtime command configured for agent "${agentType}"`);
    }

    const binary = extractCommandBinary(configuredCommand);

    if (!binary) {
      throw new DependencyError(
        `Unable to resolve the executable for agent "${agentType}" from command "${configuredCommand}"`,
      );
    }

    const result = await runCommand(
      '/bin/sh',
      ['-lc', `command -v ${shellQuote(binary)}`],
      { allowNonZero: true },
    );

    if (result.exitCode !== 0) {
      throw new DependencyError(
        `Agent runtime "${agentType}" is unavailable. Install "${binary}" or update the configured command.`,
      );
    }
  }

  private async safeCapture(windowName: string, lines: number): Promise<string> {
    try {
      return await this.capture(windowName, lines);
    } catch (error) {
      this.options.logger.debug(
        { err: error, windowName },
        'failed to capture tmux output during startup polling',
      );
      return '';
    }
  }

  private async sendEnter(windowName: string): Promise<void> {
    await runCommand('tmux', ['send-keys', '-t', this.windowTarget(windowName), 'Enter']);
  }

  private async sendLiteral(windowName: string, value: string): Promise<void> {
    await runCommand('tmux', [
      'send-keys',
      '-t',
      this.windowTarget(windowName),
      '-l',
      value,
    ]);
  }

  private windowTarget(windowName: string): string {
    return `${this.options.hubSessionName}:${windowName}`;
  }
}

function sanitizeTmuxOutput(value: string): string {
  return value.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '').trim();
}

function containsTrustPrompt(output: string): boolean {
  return TRUST_PROMPT_MARKERS.some((marker) => output.includes(marker));
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
