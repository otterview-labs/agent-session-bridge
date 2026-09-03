import type {
  CreateSessionEventInput,
  CreateSessionMessageInput,
  SessionEventRecord,
  SessionMessageRecord,
} from '../../domain/conversation.js';

export interface ConversationRepository {
  createEvent(input: CreateSessionEventInput): Promise<SessionEventRecord>;
  createMessage(input: CreateSessionMessageInput): Promise<SessionMessageRecord>;
  findLatestMessageBySession(sessionId: number): Promise<SessionMessageRecord | null>;
  findMessagesBySession(sessionId: number, limit: number): Promise<SessionMessageRecord[]>;
}
