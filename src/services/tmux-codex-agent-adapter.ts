import type { Logger } from 'pino';

import { TmuxManager } from '../infra/tmux/tmux-manager.js';
import { TmuxCliAgentAdapter } from './tmux-cli-agent-adapter.js';

type TmuxCodexAgentAdapterOptions = {
  logger: Logger;
  tmuxManager: TmuxManager;
};

export class TmuxCodexAgentAdapter extends TmuxCliAgentAdapter {
  constructor(options: TmuxCodexAgentAdapterOptions) {
    super({
      ...options,
      agentType: 'codex',
    });
  }
}
