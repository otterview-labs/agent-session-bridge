import type { AgentType } from './agent.js';
import type { ApprovalStatus } from './approval.js';

export type CommandContext = {
  actorId: string;
};

export type ParsedCommand =
  | { name: 'help' }
  | { name: 'ping' }
  | { name: 'list' }
  | { name: 'sessions' }
  | { name: 'watch'; forceRun: boolean }
  | { name: 'current' }
  | { agentType?: AgentType; name: 'new'; sessionName: string; workspacePath: string }
  | { name: 'use'; sessionName: string }
  | { name: 'inspect'; sessionName?: string }
  | { name: 'status'; sessionName?: string }
  | { name: 'send'; sessionName: string; prompt: string }
  | { name: 'ask'; prompt: string }
  | { name: 'tail'; sessionName?: string }
  | { name: 'stop'; sessionName: string }
  | { name: 'rename'; oldName: string; newName: string }
  | { name: 'approvals'; status?: ApprovalStatus | 'all' }
  | { name: 'approve'; approvalId: number }
  | { name: 'deny'; approvalId: number; reason?: string }
  | { name: 'files'; path?: string; sessionName?: string }
  | { name: 'cat'; path: string; sessionName: string }
  | { name: 'git'; path?: string; sessionName: string; subcommand: 'diff' | 'status' }
  | { name: 'diff'; path?: string; sessionName: string }
  | { name: 'terminal'; command: string; sessionName: string }
  | { name: 'terminal-status'; commandId: number }
  | { name: 'terminal-cancel'; commandId: number }
  | { name: 'machines' }
  | { name: 'notify'; subcommand: 'test' }
  | {
      agentType?: AgentType;
      machine: string;
      name: 'spawn';
      sessionName: string;
      workspacePath: string;
    };
