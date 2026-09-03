import type { AgentType } from '../../domain/agent.js';
import type { SessionRecord, SessionStatus } from '../../domain/session.js';

export type CreateSessionRecordInput = {
  agentType: AgentType;
  defaultForActor: boolean;
  lastOutputDigest: string | null;
  name: string;
  ownerActorId: string | null;
  status: SessionStatus;
  tmuxSessionName: string;
  tmuxWindowName: string;
  workspacePath: string;
};

export interface SessionRepository {
  clearDefaultForActor(actorId: string): Promise<void>;
  create(input: CreateSessionRecordInput): Promise<SessionRecord>;
  findAll(): Promise<SessionRecord[]>;
  findByName(name: string): Promise<SessionRecord | null>;
  findCurrentForActor(actorId: string): Promise<SessionRecord | null>;
  rename(id: number, newName: string, tmuxWindowName: string): Promise<void>;
  setDefaultForActor(id: number, actorId: string): Promise<void>;
  updateDigest(id: number, digest: string | null): Promise<void>;
  updateStatus(id: number, status: SessionStatus): Promise<void>;
}
