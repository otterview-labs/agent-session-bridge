export const AGENT_TYPES = [
  'codex',
  'claude-code',
  'gemini',
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export type AgentSessionHandle = {
  tmuxSessionName: string;
  tmuxWindowName: string;
};

export type CreateAgentSessionInput = {
  name: string;
  workspacePath: string;
};

export interface AgentAdapter {
  readonly agentType: AgentType;
  captureOutput(handle: AgentSessionHandle, lines: number): Promise<string>;
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle>;
  hasSession(handle: AgentSessionHandle): Promise<boolean>;
  renameSession(handle: AgentSessionHandle, newName: string): Promise<AgentSessionHandle>;
  sanitizeSessionName(name: string): string;
  sendMessage(handle: AgentSessionHandle, message: string): Promise<void>;
  stopSession(handle: AgentSessionHandle): Promise<void>;
}
