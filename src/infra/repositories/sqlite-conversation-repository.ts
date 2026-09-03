import type { Logger } from 'pino';

import type {
  CreateSessionEventInput,
  CreateSessionMessageInput,
  JsonObject,
  SessionEventRecord,
  SessionMessageRecord,
} from '../../domain/conversation.js';
import type { ConversationRepository } from './conversation-repository.js';
import { DatabaseClient } from '../storage/database.js';

type SessionMessageRow = {
  actor_id: string | null;
  content: string;
  created_at: string;
  id: number;
  metadata_json: string | null;
  role: SessionMessageRecord['role'];
  session_id: number;
  source: string;
};

type SessionEventRow = {
  actor_id: string | null;
  created_at: string;
  event_type: string;
  id: number;
  payload_json: string | null;
  session_id: number | null;
  session_name: string | null;
};

export class SqliteConversationRepository implements ConversationRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly logger: Logger,
  ) {}

  async createEvent(input: CreateSessionEventInput): Promise<SessionEventRecord> {
    const statement = this.database.prepare(
      `
      INSERT INTO session_events (
        session_id,
        session_name,
        event_type,
        payload_json,
        actor_id
      )
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
      `,
    );
    const row = statement.get(
      input.sessionId ?? null,
      input.sessionName ?? null,
      input.eventType,
      serializeJson(input.payload ?? {}),
      input.actorId ?? null,
    ) as SessionEventRow;

    this.logger.debug(
      { eventType: input.eventType, sessionId: input.sessionId ?? null },
      'session event created',
    );
    return mapEventRow(row);
  }

  async createMessage(input: CreateSessionMessageInput): Promise<SessionMessageRecord> {
    const statement = this.database.prepare(
      `
      INSERT INTO session_messages (
        session_id,
        role,
        content,
        source,
        actor_id,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
      `,
    );
    const row = statement.get(
      input.sessionId,
      input.role,
      input.content,
      input.source,
      input.actorId ?? null,
      serializeJson(input.metadata ?? null),
    ) as SessionMessageRow;

    this.logger.debug({ sessionId: input.sessionId, role: input.role }, 'session message created');
    return mapMessageRow(row);
  }

  async findLatestMessageBySession(sessionId: number): Promise<SessionMessageRecord | null> {
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM session_messages
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
      )
      .get(sessionId) as SessionMessageRow | undefined;

    return row ? mapMessageRow(row) : null;
  }

  async findMessagesBySession(sessionId: number, limit: number): Promise<SessionMessageRecord[]> {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM session_messages
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT ?
        `,
      )
      .all(sessionId, limit) as SessionMessageRow[];

    return rows.reverse().map(mapMessageRow);
  }
}

function mapMessageRow(row: SessionMessageRow): SessionMessageRecord {
  return {
    actorId: row.actor_id,
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    metadata: parseJsonObject(row.metadata_json),
    role: row.role,
    sessionId: row.session_id,
    source: row.source,
  };
}

function mapEventRow(row: SessionEventRow): SessionEventRecord {
  return {
    actorId: row.actor_id,
    createdAt: row.created_at,
    eventType: row.event_type,
    id: row.id,
    payload: parseJsonObject(row.payload_json) ?? {},
    sessionId: row.session_id,
    sessionName: row.session_name,
  };
}

function serializeJson(value: JsonObject | null): string | null {
  if (!value) {
    return null;
  }

  return JSON.stringify(value);
}

function parseJsonObject(value: string | null): JsonObject | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    return null;
  }

  return null;
}
