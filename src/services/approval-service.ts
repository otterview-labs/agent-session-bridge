import type { Logger } from 'pino';

import type {
  ApprovalRequestRecord,
  ApprovalRiskLevel,
  ApprovalStatus,
} from '../domain/approval.js';
import { DomainError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { ApprovalRepository } from '../infra/repositories/approval-repository.js';
import { ConversationService } from './conversation-service.js';
import { ServerManagerService } from './server-manager-service.js';
import { SessionService } from './session-service.js';
import type { TerminalService } from './terminal-service.js';

type ApprovalServiceOptions = {
  conversationService: ConversationService;
  logger: Logger;
  repository: ApprovalRepository;
  serverManagerService: ServerManagerService;
  sessionService: SessionService;
  terminalService: TerminalService;
};

export class ApprovalService {
  constructor(private readonly options: ApprovalServiceOptions) {}

  async listApprovals(options: {
    limit?: number;
    sessionId?: number | null;
    status?: ApprovalStatus | null;
  } = {}): Promise<ApprovalRequestRecord[]> {
    return this.options.repository.findMany(options);
  }

  async getApproval(id: number): Promise<ApprovalRequestRecord> {
    const approval = await this.options.repository.findById(id);

    if (!approval) {
      throw new NotFoundError(`Approval "${id}" was not found`);
    }

    return approval;
  }

  async requestSessionStop(input: {
    actorId: string;
    sessionName: string;
  }): Promise<ApprovalRequestRecord> {
    const session = await this.options.sessionService.requireByName(input.sessionName);
    const dedupeKey = `session_stop:${session.id}`;
    const existing = await this.options.repository.findPendingByDedupeKey(dedupeKey);

    if (existing) {
      return existing;
    }

    const approval = await this.options.repository.create({
      dedupeKey,
      description: `停止会话 "${session.name}" 并关闭对应 tmux 窗口。`,
      payload: {
        actorId: input.actorId,
        sessionName: session.name,
      },
      requestType: 'session_stop',
      requestedBy: input.actorId,
      riskLevel: 'high',
      sessionId: session.id,
      sessionName: session.name,
      title: `停止会话 ${session.name}`,
    });

    await this.publishRequestedMessage(approval);
    return approval;
  }

  async requestTerminalCommand(input: {
    actorId: string;
    command: string;
    riskLevel: ApprovalRiskLevel;
    sessionName: string;
  }): Promise<ApprovalRequestRecord> {
    const session = await this.options.sessionService.requireByName(input.sessionName);
    const approval = await this.options.repository.create({
      description: `在工作区中执行命令：${input.command}`,
      payload: {
        actorId: input.actorId,
        command: input.command,
        sessionName: session.name,
      },
      requestType: 'terminal_command',
      requestedBy: input.actorId,
      riskLevel: input.riskLevel,
      sessionId: session.id,
      sessionName: session.name,
      title: `执行终端命令 · ${session.name}`,
    });

    await this.publishRequestedMessage(approval);
    return approval;
  }

  async requestManagedServiceAction(input: {
    action: 'exec' | 'restart' | 'start' | 'stop';
    actorId: string;
    command?: string;
    projectName: string;
    riskLevel: ApprovalRiskLevel;
    serverName: string;
  }): Promise<ApprovalRequestRecord> {
    const dedupeKey =
      input.action === 'exec'
        ? null
        : `managed_service:${input.serverName}:${input.projectName}:${input.action}`;
    const existing = dedupeKey
      ? await this.options.repository.findPendingByDedupeKey(dedupeKey)
      : null;

    if (existing) {
      return existing;
    }

    const title =
      input.action === 'exec'
        ? `远程执行命令 · ${input.serverName}/${input.projectName}`
        : `${renderManagedActionLabel(input.action)} · ${input.serverName}/${input.projectName}`;
    const description =
      input.action === 'exec'
        ? `在 ${input.serverName}/${input.projectName} 中执行远程命令：${input.command ?? ''}`
        : `对 ${input.serverName}/${input.projectName} 执行动作：${input.action}`;
    const approval = await this.options.repository.create({
      dedupeKey,
      description,
      payload: {
        action: input.action,
        actorId: input.actorId,
        command: input.command ?? null,
        projectName: input.projectName,
        serverName: input.serverName,
      },
      requestType: 'managed_service_action',
      requestedBy: input.actorId,
      riskLevel: input.riskLevel,
      title,
    });

    await this.publishRequestedMessage(approval);
    return approval;
  }

  async approve(id: number, resolvedBy: string): Promise<ApprovalRequestRecord> {
    const approval = await this.getApproval(id);

    if (approval.status !== 'pending') {
      throw new ValidationError(`Approval "${id}" is already ${approval.status}`);
    }

    const executing = await this.options.repository.markExecuting(id, resolvedBy);
    if (!executing) {
      return this.throwTransitionConflict(id);
    }

    try {
      await this.executeApprovalAction(executing, resolvedBy);
    } catch (error) {
      const failed = await this.options.repository.resolve({
        expectedStatus: 'executing',
        id,
        resolutionNote: error instanceof Error ? error.message : 'Approval execution failed',
        resolvedBy,
        status: 'failed',
      });

      if (failed) {
        await this.publishResolvedMessage(failed);
      } else {
        this.options.logger.error(
          { approvalId: id, err: error },
          'approval action failed after its executing state was changed unexpectedly',
        );
      }

      throw error;
    }

    const resolved = await this.options.repository.resolve({
      expectedStatus: 'executing',
      id,
      resolvedBy,
      status: 'approved',
    });

    if (!resolved) {
      return this.throwTransitionConflict(id);
    }

    await this.publishResolvedMessage(resolved);
    return resolved;
  }

  async deny(
    id: number,
    resolvedBy: string,
    resolutionNote?: string | null,
  ): Promise<ApprovalRequestRecord> {
    const approval = await this.getApproval(id);

    if (approval.status !== 'pending') {
      throw new ValidationError(`Approval "${id}" is already ${approval.status}`);
    }

    const resolved = await this.options.repository.resolve({
      expectedStatus: 'pending',
      id,
      resolutionNote,
      resolvedBy,
      status: 'denied',
    });

    if (!resolved) {
      return this.throwTransitionConflict(id);
    }

    await this.publishResolvedMessage(resolved);
    return resolved;
  }

  private async throwTransitionConflict(id: number): Promise<never> {
    const current = await this.options.repository.findById(id);

    if (!current) {
      throw new NotFoundError(`Approval "${id}" was not found`);
    }

    throw new ValidationError(`Approval "${id}" is already ${current.status}`);
  }

  private async executeApprovalAction(
    approval: ApprovalRequestRecord,
    resolvedBy: string,
  ): Promise<void> {
    switch (approval.requestType) {
      case 'session_stop': {
        const sessionName = requirePayloadString(approval.payload.sessionName, 'sessionName');
        await this.options.sessionService.stopSessionImmediate(sessionName, resolvedBy);
        return;
      }
      case 'terminal_command': {
        const command = requirePayloadString(approval.payload.command, 'command');
        const sessionName = requirePayloadString(approval.payload.sessionName, 'sessionName');
        await this.options.terminalService.startCommand({
          actorId: resolvedBy,
          approvalRequestId: approval.id,
          command,
          sessionName,
        });
        return;
      }
      case 'managed_service_action': {
        const action = requirePayloadString(approval.payload.action, 'action');
        const serverName = requirePayloadString(approval.payload.serverName, 'serverName');
        const projectName = requirePayloadString(approval.payload.projectName, 'projectName');

        if (action === 'start' || action === 'stop' || action === 'restart') {
          await this.options.serverManagerService.runServiceAction(
            action,
            serverName,
            projectName,
          );
          return;
        }

        if (action === 'exec') {
          const command = requirePayloadString(approval.payload.command, 'command');
          await this.options.serverManagerService.executeProjectCommand(
            serverName,
            projectName,
            command,
          );
          return;
        }

        throw new DomainError(`Unsupported managed service action "${action}"`);
      }
      case 'spawn':
        throw new DomainError('Spawn approvals are not wired yet');
      default:
        throw new DomainError(`Unsupported approval type: ${approval.requestType}`);
    }
  }

  private async publishRequestedMessage(approval: ApprovalRequestRecord): Promise<void> {
    if (approval.sessionId) {
      await this.options.conversationService.createMessage({
        actorId: approval.requestedBy,
        content: `待审批：${approval.title}\n${approval.description}`,
        metadata: {
          action: 'approval.requested',
          approvalId: approval.id,
          riskLevel: approval.riskLevel,
          status: approval.status,
        },
        role: 'approval',
        sessionId: approval.sessionId,
        sessionName: approval.sessionName,
        source: 'approval-service',
      });
    }

    await this.options.conversationService.recordEvent({
      actorId: approval.requestedBy,
      eventType: 'approval.requested',
      payload: {
        approvalId: approval.id,
        requestType: approval.requestType,
        riskLevel: approval.riskLevel,
        status: approval.status,
        title: approval.title,
      },
      sessionId: approval.sessionId,
      sessionName: approval.sessionName,
    });
    this.options.logger.info({ approvalId: approval.id }, 'approval requested');
  }

  private async publishResolvedMessage(approval: ApprovalRequestRecord): Promise<void> {
    if (approval.sessionId) {
      await this.options.conversationService.createMessage({
        actorId: approval.resolvedBy,
        content: `审批${approval.status === 'approved' ? '通过' : '拒绝'}：${approval.title}`,
        metadata: {
          action: 'approval.resolved',
          approvalId: approval.id,
          resolvedBy: approval.resolvedBy,
          status: approval.status,
        },
        role: 'approval',
        sessionId: approval.sessionId,
        sessionName: approval.sessionName,
        source: 'approval-service',
      });
    }

    await this.options.conversationService.recordEvent({
      actorId: approval.resolvedBy,
      eventType: 'approval.resolved',
      payload: {
        approvalId: approval.id,
        requestType: approval.requestType,
        resolvedBy: approval.resolvedBy,
        status: approval.status,
        title: approval.title,
      },
      sessionId: approval.sessionId,
      sessionName: approval.sessionName,
    });
    this.options.logger.info({ approvalId: approval.id, status: approval.status }, 'approval resolved');
  }
}

function requirePayloadString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`Approval payload field "${field}" is required`);
  }

  return value.trim();
}

function renderManagedActionLabel(action: 'restart' | 'start' | 'stop'): string {
  switch (action) {
    case 'start':
      return '启动服务';
    case 'stop':
      return '停止服务';
    case 'restart':
      return '重启服务';
  }
}
