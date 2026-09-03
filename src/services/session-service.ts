import fs from 'node:fs';
import path from 'node:path';

import type { Logger } from 'pino';

import type { AgentAdapter, AgentSessionHandle, AgentType } from '../domain/agent.js';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  ValidationError,
} from '../domain/errors.js';
import type {
  CreateSessionInput,
  SessionInspection,
  SessionObservedState,
  SendPromptInput,
  SessionRecord,
} from '../domain/session.js';
import type { SessionRepository } from '../infra/repositories/session-repository.js';
import { truncateDigest } from '../utils/text.js';
import { ConversationService } from './conversation-service.js';

type SessionServiceOptions = {
  agentAdapters: Record<AgentType, AgentAdapter>;
  allowedWorkspaceRoots: string[];
  conversationService: ConversationService;
  defaultTailLines: number;
  logger: Logger;
  repository: SessionRepository;
};

export class SessionService {
  constructor(private readonly options: SessionServiceOptions) {}

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const existing = await this.options.repository.findByName(input.name);

    if (existing) {
      throw new ConflictError(`Session "${input.name}" already exists`);
    }

    const workspacePath = this.resolveWorkspacePath(input.workspacePath);
    this.ensureWorkspaceAllowed(workspacePath);
    const agentType = input.agentType ?? 'codex';
    const agentAdapter = this.getAgentAdapter(agentType);

    const sanitizedWindowName = this.requireWindowName(
      agentAdapter.sanitizeSessionName(input.name),
      input.name,
    );

    const handle = await agentAdapter.createSession({
      name: sanitizedWindowName,
      workspacePath,
    });
    await this.options.repository.clearDefaultForActor(input.actorId);

    const session = await this.options.repository.create({
      agentType,
      defaultForActor: true,
      lastOutputDigest: `${agentType} session started`,
      name: input.name,
      ownerActorId: input.actorId,
      status: 'idle',
      tmuxSessionName: handle.tmuxSessionName,
      tmuxWindowName: handle.tmuxWindowName,
      workspacePath,
    });

    this.options.logger.info({ sessionName: session.name }, 'session created');
    await this.options.conversationService.createMessage({
      actorId: input.actorId,
      content: `Session created at ${session.workspacePath}`,
      metadata: {
        action: 'session.created',
        workspacePath: session.workspacePath,
      },
      role: 'system',
      sessionId: session.id,
      sessionName: session.name,
      source: 'session-service',
    });
    await this.options.conversationService.recordEvent({
      actorId: input.actorId,
      eventType: 'session.created',
      payload: {
        status: session.status,
        workspacePath: session.workspacePath,
      },
      sessionId: session.id,
      sessionName: session.name,
    });
    return session;
  }

  async getCurrentSession(actorId: string): Promise<SessionRecord | null> {
    return this.options.repository.findCurrentForActor(actorId);
  }

  async listSessions(): Promise<SessionRecord[]> {
    return this.options.repository.findAll();
  }

  async inspectAllSessions(lines = this.options.defaultTailLines): Promise<SessionInspection[]> {
    const sessions = await this.options.repository.findAll();
    const inspections: SessionInspection[] = [];

    for (const session of sessions) {
      inspections.push(await this.inspectSession(session.name, lines));
    }

    return inspections;
  }

  async inspectCurrentSession(
    actorId: string,
    lines = this.options.defaultTailLines,
  ): Promise<SessionInspection> {
    const session = await this.requireCurrentSession(actorId);
    return this.inspectSession(session.name, lines);
  }

  async inspectSession(
    name: string,
    lines = this.options.defaultTailLines,
  ): Promise<SessionInspection> {
    const session = await this.requireByName(name);
    const checkedAt = new Date().toISOString();
    const agentAdapter = this.getAgentAdapter(session.agentType);
    const windowExists = await agentAdapter.hasSession(this.toHandle(session));

    if (!windowExists) {
      const nextStatus = session.status === 'stopped' ? 'stopped' : 'error';
      const note =
        session.status === 'stopped'
          ? 'Session is stopped and the tmux window is absent'
          : 'tmux window is missing';

      await this.options.repository.updateStatus(session.id, nextStatus);
      await this.options.repository.updateDigest(session.id, note);
      await this.options.conversationService.recordEvent({
        actorId: session.ownerActorId,
        eventType: 'session.updated',
        payload: {
          note,
          observedState: 'missing_window',
          status: nextStatus,
          windowExists: false,
        },
        sessionId: session.id,
        sessionName: session.name,
      });

      return {
        checkedAt,
        note,
        observedState: 'missing_window',
        session: await this.requireByName(name),
        tail: '',
        tailDigest: note,
        windowExists: false,
      };
    }

    const tail = await agentAdapter.captureOutput(this.toHandle(session), lines);
    const inference = inferObservedState(tail);
    const digest = truncateDigest(tail);
    const nextStatus = inference.observedState === 'active' ? 'busy' : 'idle';

    await this.options.repository.updateDigest(session.id, digest);
    await this.options.repository.updateStatus(session.id, nextStatus);
    await this.options.conversationService.recordEvent({
      actorId: session.ownerActorId,
      eventType: 'session.updated',
      payload: {
        note: inference.note,
        observedState: inference.observedState,
        status: nextStatus,
        windowExists: true,
      },
      sessionId: session.id,
      sessionName: session.name,
    });

    return {
      checkedAt,
      note: inference.note,
      observedState: inference.observedState,
      session: await this.requireByName(name),
      tail,
      tailDigest: digest,
      windowExists: true,
    };
  }

  async renameSession(oldName: string, newName: string): Promise<SessionRecord> {
    const session = await this.requireByName(oldName);

    if (oldName === newName) {
      return session;
    }

    const existing = await this.options.repository.findByName(newName);

    if (existing) {
      throw new ConflictError(`Session "${newName}" already exists`);
    }

    const nextWindowName = this.requireWindowName(
      this.getAgentAdapter(session.agentType).sanitizeSessionName(newName),
      newName,
    );

    const handle = await this.getAgentAdapter(session.agentType).renameSession(
      this.toHandle(session),
      nextWindowName,
    );
    await this.options.repository.rename(session.id, newName, handle.tmuxWindowName);
    const renamed = await this.requireByName(newName);
    await this.options.conversationService.createMessage({
      actorId: session.ownerActorId,
      content: `Session renamed from ${oldName} to ${newName}`,
      metadata: {
        action: 'session.renamed',
        from: oldName,
        to: newName,
      },
      role: 'system',
      sessionId: renamed.id,
      sessionName: renamed.name,
      source: 'session-service',
    });
    await this.options.conversationService.recordEvent({
      actorId: session.ownerActorId,
      eventType: 'session.renamed',
      payload: {
        from: oldName,
        to: newName,
      },
      sessionId: renamed.id,
      sessionName: renamed.name,
    });
    return renamed;
  }

  async requireByName(name: string): Promise<SessionRecord> {
    const session = await this.options.repository.findByName(name);

    if (!session) {
      throw new NotFoundError(`Session "${name}" was not found`);
    }

    return session;
  }

  async requireCurrentSession(actorId: string): Promise<SessionRecord> {
    const session = await this.getCurrentSession(actorId);

    if (!session) {
      throw new NotFoundError('No current session is selected');
    }

    return session;
  }

  async sendPrompt(input: SendPromptInput): Promise<SessionRecord> {
    const session = await this.requireByName(input.name);

    if (!input.prompt.trim()) {
      throw new ValidationError('Prompt cannot be empty');
    }

    await this.options.conversationService.createMessage({
      actorId: input.actorId,
      content: input.prompt,
      metadata: {
        action: 'session.prompt',
      },
      role: 'user',
      sessionId: session.id,
      sessionName: session.name,
      source: input.actorId,
    });
    await this.options.repository.updateStatus(session.id, 'busy');
    await this.options.repository.updateDigest(session.id, `Prompt sent: ${truncateDigest(input.prompt)}`);
    await this.options.conversationService.recordEvent({
      actorId: input.actorId,
      eventType: 'session.updated',
      payload: {
        digest: `Prompt sent: ${truncateDigest(input.prompt)}`,
        status: 'busy',
      },
      sessionId: session.id,
      sessionName: session.name,
    });
    await this.getAgentAdapter(session.agentType).sendMessage(this.toHandle(session), input.prompt);
    await this.options.conversationService.recordEvent({
      actorId: input.actorId,
      eventType: 'session.prompt.sent',
      payload: {
        status: 'busy',
      },
      sessionId: session.id,
      sessionName: session.name,
    });

    return this.requireByName(session.name);
  }

  async sendPromptToCurrent(actorId: string, prompt: string): Promise<SessionRecord> {
    const session = await this.requireCurrentSession(actorId);
    return this.sendPrompt({
      actorId,
      name: session.name,
      prompt,
    });
  }

  async setCurrentSession(actorId: string, sessionName: string): Promise<SessionRecord> {
    const session = await this.requireByName(sessionName);

    if (session.ownerActorId && session.ownerActorId !== actorId) {
      throw new ValidationError(`Session "${sessionName}" belongs to another actor`);
    }

    await this.options.repository.clearDefaultForActor(actorId);
    await this.options.repository.setDefaultForActor(session.id, actorId);
    this.options.logger.debug({ actorId, sessionName }, 'default session updated');
    const current = await this.requireByName(sessionName);
    await this.options.conversationService.recordEvent({
      actorId,
      eventType: 'session.current.changed',
      payload: {
        defaultForActor: true,
      },
      sessionId: current.id,
      sessionName: current.name,
    });
    return current;
  }

  async stopSessionImmediate(name: string, actorId?: string | null): Promise<SessionRecord> {
    const session = await this.requireByName(name);
    await this.getAgentAdapter(session.agentType).stopSession(this.toHandle(session));
    await this.options.repository.updateStatus(session.id, 'stopped');
    await this.options.repository.updateDigest(session.id, 'Session stopped');
    const stopped = await this.requireByName(name);
    await this.options.conversationService.createMessage({
      actorId: actorId ?? session.ownerActorId,
      content: 'Session stopped',
      metadata: {
        action: 'session.stopped',
      },
      role: 'system',
      sessionId: stopped.id,
      sessionName: stopped.name,
      source: 'session-service',
    });
    await this.options.conversationService.recordEvent({
      actorId: actorId ?? session.ownerActorId,
      eventType: 'session.stopped',
      payload: {
        status: stopped.status,
      },
      sessionId: stopped.id,
      sessionName: stopped.name,
    });
    return stopped;
  }

  async stopSession(name: string): Promise<SessionRecord> {
    return this.stopSessionImmediate(name);
  }

  async tailCurrentSession(actorId: string): Promise<string> {
    const session = await this.requireCurrentSession(actorId);
    return this.tailSession(session.name);
  }

  async tailSession(name: string): Promise<string> {
    const session = await this.requireByName(name);
    const output = await this.getAgentAdapter(session.agentType).captureOutput(
      this.toHandle(session),
      this.options.defaultTailLines,
    );
    await this.options.repository.updateDigest(session.id, truncateDigest(output));

    if (output.trim()) {
      await this.options.conversationService.createMessageIfChanged({
        actorId: session.ownerActorId,
        content: output,
        metadata: {
          action: 'session.tail',
        },
        role: 'assistant',
        sessionId: session.id,
        sessionName: session.name,
        source: 'tmux-tail',
      });
    }

    await this.options.conversationService.recordEvent({
      actorId: session.ownerActorId,
      eventType: 'session.tail.updated',
      payload: {
        digest: truncateDigest(output),
        lines: this.options.defaultTailLines,
      },
      sessionId: session.id,
      sessionName: session.name,
    });
    return output;
  }

  private ensureWorkspaceAllowed(workspacePath: string): void {
    const roots = this.options.allowedWorkspaceRoots;

    if (roots.length === 0) {
      return;
    }

    const allowed = roots.some((root) => {
      const resolvedRoot = path.resolve(root);
      const canonicalRoot = fs.existsSync(resolvedRoot)
        ? fs.realpathSync(resolvedRoot)
        : resolvedRoot;

      return (
        workspacePath === canonicalRoot ||
        workspacePath.startsWith(`${canonicalRoot}${path.sep}`)
      );
    });

    if (!allowed) {
      throw new ValidationError(
        `Workspace "${workspacePath}" is outside allowed roots: ${roots.join(', ')}`,
      );
    }
  }

  private requireWindowName(value: string, originalName: string): string {
    if (!value) {
      throw new ValidationError(
        `Session name "${originalName}" cannot be converted into a valid tmux window name`,
      );
    }

    return value;
  }

  private resolveWorkspacePath(input: string): string {
    const workspacePath = path.resolve(input);

    if (!fs.existsSync(workspacePath)) {
      throw new ValidationError(`Workspace path does not exist: ${workspacePath}`);
    }

    if (!fs.statSync(workspacePath).isDirectory()) {
      throw new ValidationError(`Workspace path is not a directory: ${workspacePath}`);
    }

    return fs.realpathSync(workspacePath);
  }

  private toHandle(session: SessionRecord): AgentSessionHandle {
    return {
      tmuxSessionName: session.tmuxSessionName,
      tmuxWindowName: session.tmuxWindowName,
    };
  }

  private getAgentAdapter(agentType: AgentType): AgentAdapter {
    const adapter = this.options.agentAdapters[agentType];

    if (!adapter) {
      throw new DomainError(`No agent adapter is registered for "${agentType}"`);
    }

    return adapter;
  }
}

function inferObservedState(
  tail: string,
): { note: string; observedState: SessionObservedState } {
  if (!tail.trim()) {
    return {
      note: 'tmux window is alive but there is no visible output yet',
      observedState: 'unknown',
    };
  }

  if (
    tail.includes('OpenAI Codex') &&
    tail.includes('/model to change') &&
    tail.includes('· ~/')
  ) {
    return {
      note: 'Codex UI is ready and waiting for input',
      observedState: 'ready',
    };
  }

  if (tail.includes('OpenAI Codex') && tail.includes('/model to change')) {
    return {
      note: 'Codex UI is active',
      observedState: 'active',
    };
  }

  if (
    tail.includes('Do you trust the contents of this directory?') ||
    tail.includes('Press enter to continue')
  ) {
    return {
      note: 'Codex is waiting on the workspace trust prompt',
      observedState: 'trust_prompt',
    };
  }

  return {
    note: 'tmux window is alive with recent terminal output',
    observedState: 'active',
  };
}
