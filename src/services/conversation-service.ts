import type { Logger } from 'pino';

import type {
  CreateSessionEventInput,
  CreateSessionMessageInput,
  SessionEventRecord,
  SessionMessageRecord,
} from '../domain/conversation.js';
import type { ConversationRepository } from '../infra/repositories/conversation-repository.js';
import { SessionEventBus } from './session-event-bus.js';

type ConversationServiceOptions = {
  eventBus: SessionEventBus;
  logger: Logger;
  repository: ConversationRepository;
};

export class ConversationService {
  constructor(private readonly options: ConversationServiceOptions) {}

  async createMessage(input: CreateSessionMessageInput): Promise<SessionMessageRecord> {
    const message = await this.options.repository.createMessage(input);
    this.options.eventBus.publish({
      actorId: message.actorId,
      eventType: 'message.created',
      payload: {
        content: message.content,
        createdAt: message.createdAt,
        id: message.id,
        role: message.role,
        source: message.source,
      },
      sessionId: message.sessionId,
      sessionName: input.sessionName ?? null,
    });
    this.options.logger.debug(
      { messageId: message.id, role: message.role, sessionId: message.sessionId },
      'message stored and published',
    );
    return message;
  }

  async createMessageIfChanged(
    input: CreateSessionMessageInput,
  ): Promise<SessionMessageRecord | null> {
    const latest = await this.options.repository.findLatestMessageBySession(input.sessionId);

    if (
      latest &&
      latest.role === input.role &&
      latest.content === input.content &&
      latest.source === input.source
    ) {
      return null;
    }

    return this.createMessage(input);
  }

  async listMessagesBySession(sessionId: number, limit: number): Promise<SessionMessageRecord[]> {
    return this.options.repository.findMessagesBySession(sessionId, limit);
  }

  async recordEvent(input: CreateSessionEventInput): Promise<SessionEventRecord> {
    const event = await this.options.repository.createEvent(input);
    this.options.eventBus.publish({
      actorId: event.actorId,
      eventType: event.eventType,
      payload: event.payload,
      sessionId: event.sessionId,
      sessionName: event.sessionName,
    });
    this.options.logger.debug(
      { eventType: event.eventType, sessionId: event.sessionId },
      'event stored and published',
    );
    return event;
  }
}
