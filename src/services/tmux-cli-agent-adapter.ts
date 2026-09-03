import type { Logger } from 'pino';

import type {
  AgentAdapter,
  AgentSessionHandle,
  AgentType,
  CreateAgentSessionInput,
} from '../domain/agent.js';
import { TmuxManager } from '../infra/tmux/tmux-manager.js';

type TmuxCliAgentAdapterOptions = {
  agentType: AgentType;
  logger: Logger;
  tmuxManager: TmuxManager;
};

export class TmuxCliAgentAdapter implements AgentAdapter {
  readonly agentType: AgentType;

  constructor(private readonly options: TmuxCliAgentAdapterOptions) {
    this.agentType = options.agentType;
  }

  async captureOutput(handle: AgentSessionHandle, lines: number): Promise<string> {
    return this.options.tmuxManager.capture(handle.tmuxWindowName, lines);
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle> {
    const tmuxWindowName = this.sanitizeSessionName(input.name);

    await this.options.tmuxManager.createAgentWindow(
      this.agentType,
      tmuxWindowName,
      input.workspacePath,
    );
    this.options.logger.debug(
      { agentType: this.agentType, name: input.name, tmuxWindowName },
      'agent session created',
    );

    return {
      tmuxSessionName: this.options.tmuxManager.getHubSessionName(),
      tmuxWindowName,
    };
  }

  async hasSession(handle: AgentSessionHandle): Promise<boolean> {
    return this.options.tmuxManager.hasWindow(handle.tmuxWindowName);
  }

  async renameSession(
    handle: AgentSessionHandle,
    newName: string,
  ): Promise<AgentSessionHandle> {
    const tmuxWindowName = this.sanitizeSessionName(newName);
    await this.options.tmuxManager.renameWindow(handle.tmuxWindowName, tmuxWindowName);

    return {
      tmuxSessionName: handle.tmuxSessionName,
      tmuxWindowName,
    };
  }

  sanitizeSessionName(name: string): string {
    return this.options.tmuxManager.sanitizeWindowName(name);
  }

  async sendMessage(handle: AgentSessionHandle, message: string): Promise<void> {
    await this.options.tmuxManager.sendPrompt(handle.tmuxWindowName, message);
  }

  async stopSession(handle: AgentSessionHandle): Promise<void> {
    await this.options.tmuxManager.killWindow(handle.tmuxWindowName);
  }
}
