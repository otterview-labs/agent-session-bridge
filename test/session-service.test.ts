import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AgentAdapter, AgentSessionHandle } from '../src/domain/agent.js';
import type {
  CreateSessionEventInput,
  CreateSessionMessageInput,
  SessionEventRecord,
  SessionMessageRecord,
} from '../src/domain/conversation.js';
import type { SessionRecord, SessionStatus } from '../src/domain/session.js';
import type {
  CreateSessionRecordInput,
  SessionRepository,
} from '../src/infra/repositories/session-repository.js';
import { ConversationService } from '../src/services/conversation-service.js';
import { SessionEventBus } from '../src/services/session-event-bus.js';
import { SessionService } from '../src/services/session-service.js';

test('sendPrompt keeps the session busy until inspection observes the runtime', async () => {
  const workspacePath = await mkdtemp(path.join(tmpdir(), 'asb-session-test-'));
  const repository = new MemorySessionRepository();
  const adapter = new MemoryAgentAdapter();
  const conversationRepository = new MemoryConversationRepository();
  const service = new SessionService({
    agentAdapters: {
      'claude-code': adapter,
      codex: adapter,
      gemini: adapter,
    },
    allowedWorkspaceRoots: [workspacePath],
    conversationService: new ConversationService({
      eventBus: new SessionEventBus(testLogger()),
      logger: testLogger(),
      repository: conversationRepository,
    }),
    defaultTailLines: 80,
    logger: testLogger(),
    repository,
  });

  try {
    await service.createSession({
      actorId: 'tester',
      name: 'demo',
      workspacePath,
    });

    const sent = await service.sendPrompt({
      actorId: 'tester',
      name: 'demo',
      prompt: 'do the work',
    });

    assert.equal(sent.status, 'busy');
    assert.equal(adapter.sentMessages.at(-1), 'do the work');
    assert.match(sent.lastOutputDigest ?? '', /^Prompt sent:/u);
    assert.equal(
      conversationRepository.events.some((event) => event.eventType === 'session.prompt.sent'),
      true,
    );
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
  }
});

class MemoryAgentAdapter implements AgentAdapter {
  readonly agentType = 'codex';
  readonly sentMessages: string[] = [];

  async captureOutput(): Promise<string> {
    return 'OpenAI Codex /model to change · ~/demo';
  }

  async createSession(input: { name: string }): Promise<AgentSessionHandle> {
    return {
      tmuxSessionName: 'codex-hub',
      tmuxWindowName: input.name,
    };
  }

  async hasSession(): Promise<boolean> {
    return true;
  }

  async renameSession(_handle: AgentSessionHandle, newName: string): Promise<AgentSessionHandle> {
    return {
      tmuxSessionName: 'codex-hub',
      tmuxWindowName: newName,
    };
  }

  sanitizeSessionName(name: string): string {
    return name;
  }

  async sendMessage(_handle: AgentSessionHandle, message: string): Promise<void> {
    this.sentMessages.push(message);
  }

  async stopSession(): Promise<void> {
    return undefined;
  }
}

class MemorySessionRepository implements SessionRepository {
  private nextId = 1;
  private records: SessionRecord[] = [];

  async clearDefaultForActor(actorId: string): Promise<void> {
    this.records = this.records.map((record) =>
      record.ownerActorId === actorId ? { ...record, defaultForActor: false } : record,
    );
  }

  async create(input: CreateSessionRecordInput): Promise<SessionRecord> {
    const now = '2026-05-11T00:00:00.000Z';
    const record: SessionRecord = {
      agentType: input.agentType,
      createdAt: now,
      defaultForActor: input.defaultForActor,
      id: this.nextId,
      lastActiveAt: now,
      lastOutputDigest: input.lastOutputDigest,
      name: input.name,
      ownerActorId: input.ownerActorId,
      status: input.status,
      tmuxSessionName: input.tmuxSessionName,
      tmuxWindowName: input.tmuxWindowName,
      updatedAt: now,
      workspacePath: input.workspacePath,
    };
    this.nextId += 1;
    this.records.push(record);
    return record;
  }

  async findAll(): Promise<SessionRecord[]> {
    return [...this.records];
  }

  async findByName(name: string): Promise<SessionRecord | null> {
    return this.records.find((record) => record.name === name) ?? null;
  }

  async findCurrentForActor(actorId: string): Promise<SessionRecord | null> {
    return (
      this.records.find((record) => record.ownerActorId === actorId && record.defaultForActor) ??
      null
    );
  }

  async rename(id: number, newName: string, tmuxWindowName: string): Promise<void> {
    this.records = this.records.map((record) =>
      record.id === id ? { ...record, name: newName, tmuxWindowName } : record,
    );
  }

  async setDefaultForActor(id: number, actorId: string): Promise<void> {
    this.records = this.records.map((record) =>
      record.id === id ? { ...record, defaultForActor: true, ownerActorId: actorId } : record,
    );
  }

  async updateDigest(id: number, digest: string | null): Promise<void> {
    this.records = this.records.map((record) =>
      record.id === id ? { ...record, lastOutputDigest: digest } : record,
    );
  }

  async updateStatus(id: number, status: SessionStatus): Promise<void> {
    this.records = this.records.map((record) =>
      record.id === id ? { ...record, status } : record,
    );
  }
}

class MemoryConversationRepository {
  readonly events: SessionEventRecord[] = [];
  readonly messages: SessionMessageRecord[] = [];
  private nextEventId = 1;
  private nextMessageId = 1;

  async createEvent(input: CreateSessionEventInput): Promise<SessionEventRecord> {
    const event = {
      actorId: input.actorId ?? null,
      createdAt: '2026-05-11T00:00:00.000Z',
      eventType: input.eventType,
      id: this.nextEventId,
      payload: input.payload ?? {},
      sessionId: input.sessionId ?? null,
      sessionName: input.sessionName ?? null,
    };
    this.nextEventId += 1;
    this.events.push(event);
    return event;
  }

  async createMessage(input: CreateSessionMessageInput): Promise<SessionMessageRecord> {
    const message = {
      actorId: input.actorId ?? null,
      content: input.content,
      createdAt: '2026-05-11T00:00:00.000Z',
      id: this.nextMessageId,
      metadata: input.metadata ?? null,
      role: input.role,
      sessionId: input.sessionId,
      source: input.source,
    };
    this.nextMessageId += 1;
    this.messages.push(message);
    return message;
  }

  async findLatestMessageBySession(sessionId: number): Promise<SessionMessageRecord | null> {
    return this.messages.filter((message) => message.sessionId === sessionId).at(-1) ?? null;
  }

  async findMessagesBySession(
    sessionId: number,
    limit: number,
  ): Promise<SessionMessageRecord[]> {
    return this.messages.filter((message) => message.sessionId === sessionId).slice(-limit);
  }
}

function testLogger() {
  return {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  } as never;
}
