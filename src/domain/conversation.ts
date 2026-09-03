export type JsonPrimitive = boolean | null | number | string;

export type JsonValue = JsonObject | JsonPrimitive | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export const SESSION_MESSAGE_ROLES = [
  'user',
  'assistant',
  'system',
  'tool',
  'approval',
] as const;

export type SessionMessageRole = (typeof SESSION_MESSAGE_ROLES)[number];

export type SessionMessageRecord = {
  actorId: string | null;
  content: string;
  createdAt: string;
  id: number;
  metadata: JsonObject | null;
  role: SessionMessageRole;
  sessionId: number;
  source: string;
};

export type CreateSessionMessageInput = {
  actorId?: string | null;
  content: string;
  metadata?: JsonObject | null;
  role: SessionMessageRole;
  sessionId: number;
  sessionName?: string | null;
  source: string;
};

export type SessionEventRecord = {
  actorId: string | null;
  createdAt: string;
  eventType: string;
  id: number;
  payload: JsonObject;
  sessionId: number | null;
  sessionName: string | null;
};

export type CreateSessionEventInput = {
  actorId?: string | null;
  eventType: string;
  payload?: JsonObject;
  sessionId?: number | null;
  sessionName?: string | null;
};

export type RealtimeSessionEvent = {
  actorId: string | null;
  createdAt: string;
  eventType: string;
  id: string;
  payload: JsonObject;
  sessionId: number | null;
  sessionName: string | null;
};
