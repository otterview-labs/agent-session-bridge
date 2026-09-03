import type { Logger } from 'pino';

import type { AppConfig } from '../config/env.js';
import type { RealtimeSessionEvent } from '../domain/conversation.js';
import { FeishuApiClient } from '../channels/feishu/api-client.js';
import { SessionEventBus } from './session-event-bus.js';

type NotificationServiceOptions = {
  config: AppConfig;
  eventBus: SessionEventBus;
  feishuApiClient: FeishuApiClient;
  logger: Logger;
};

export class NotificationService {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: NotificationServiceOptions) {}

  start(): void {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.options.eventBus.subscribe((event) => {
      void this.handleEvent(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async sendTestNotification(actorId: string): Promise<{ delivered: number }> {
    const delivered = await this.sendFeishuText(
      [
        'ASB 通知测试',
        `触发者：${actorId}`,
        `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        '如果你收到了这条消息，说明通知链路已经打通。',
      ].join('\n'),
    );

    this.options.eventBus.publish({
      actorId,
      eventType: 'notification.test',
      payload: {
        delivered,
      },
    });

    return { delivered };
  }

  private async handleEvent(event: RealtimeSessionEvent): Promise<void> {
    switch (event.eventType) {
      case 'approval.requested':
        await this.sendFeishuText(renderApprovalRequested(event));
        return;
      case 'approval.resolved':
        await this.sendFeishuText(renderApprovalResolved(event));
        return;
      case 'terminal.command.completed':
        if (event.payload.status === 'failed' || event.payload.status === 'cancelled') {
          await this.sendFeishuText(renderTerminalCompleted(event));
        }
        return;
      default:
        return;
    }
  }

  private async sendFeishuText(text: string): Promise<number> {
    if (!this.options.config.feishuEnabled) {
      return 0;
    }

    const targets = this.options.config.feishuNotifyChatIds;

    if (targets.length === 0) {
      return 0;
    }

    let delivered = 0;

    for (const chatId of targets) {
      try {
        await this.options.feishuApiClient.sendTextToChat(chatId, text);
        delivered += 1;
      } catch (error) {
        this.options.logger.error({ chatId, err: error }, 'failed to send Feishu notification');
      }
    }

    return delivered;
  }
}

function renderApprovalRequested(event: RealtimeSessionEvent): string {
  return [
    'ASB 有新的审批请求',
    `标题：${stringOrDash(event.payload.title)}`,
    `风险：${stringOrDash(event.payload.riskLevel)}`,
    `会话：${event.sessionName ?? '-'}`,
    `审批 ID：${stringOrDash(event.payload.approvalId)}`,
  ].join('\n');
}

function renderApprovalResolved(event: RealtimeSessionEvent): string {
  return [
    'ASB 审批已处理',
    `标题：${stringOrDash(event.payload.title)}`,
    `状态：${stringOrDash(event.payload.status)}`,
    `处理人：${stringOrDash(event.payload.resolvedBy)}`,
    `会话：${event.sessionName ?? '-'}`,
  ].join('\n');
}

function renderTerminalCompleted(event: RealtimeSessionEvent): string {
  return [
    'ASB 终端命令结束',
    `命令：${stringOrDash(event.payload.command)}`,
    `状态：${stringOrDash(event.payload.status)}`,
    `会话：${event.sessionName ?? '-'}`,
    `命令 ID：${stringOrDash(event.payload.commandId)}`,
  ].join('\n');
}

function stringOrDash(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return '-';
}
