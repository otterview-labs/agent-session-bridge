import type { AgentType } from './agent.js';

export const SESSION_STATUSES = [
  'starting',
  'idle',
  'busy',
  'stopped',
  'error',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type SessionRecord = {
  agentType: AgentType;
  createdAt: string;
  defaultForActor: boolean;
  id: number;
  lastActiveAt: string;
  lastOutputDigest: string | null;
  name: string;
  ownerActorId: string | null;
  status: SessionStatus;
  tmuxSessionName: string;
  tmuxWindowName: string;
  updatedAt: string;
  workspacePath: string;
};

export const SESSION_OBSERVED_STATES = [
  'ready',
  'active',
  'trust_prompt',
  'missing_window',
  'unknown',
] as const;

export type SessionObservedState = (typeof SESSION_OBSERVED_STATES)[number];

export type SessionInspection = {
  checkedAt: string;
  note: string;
  observedState: SessionObservedState;
  session: SessionRecord;
  tail: string;
  tailDigest: string | null;
  windowExists: boolean;
};

export type CreateSessionInput = {
  agentType?: AgentType;
  actorId: string;
  name: string;
  workspacePath: string;
};

export type SendPromptInput = {
  actorId: string;
  name: string;
  prompt: string;
};
