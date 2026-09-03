import type { Logger } from 'pino';

import { DomainError } from '../../domain/errors.js';
import { chunkString } from '../../utils/chunk.js';
import { FeishuTokenService } from './token-service.js';

type FeishuApiClientOptions = {
  logger: Logger;
  replyInThread: boolean;
  tokenService: FeishuTokenService;
};

export class FeishuApiClient {
  constructor(private readonly options: FeishuApiClientOptions) {}

  async sendTextToChat(chatId: string, text: string): Promise<void> {
    const chunks = chunkString(text, 1800);

    for (const chunk of chunks) {
      await this.sendChatTextChunk(chatId, chunk);
    }
  }

  async replyText(messageId: string, text: string): Promise<void> {
    const chunks = chunkString(text, 1800);

    for (const chunk of chunks) {
      await this.replyTextChunk(messageId, chunk);
    }
  }

  private async replyTextChunk(messageId: string, text: string): Promise<void> {
    const token = await this.options.tokenService.getTenantAccessToken();
    const response = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          content: JSON.stringify({ text }),
          msg_type: 'text',
          reply_in_thread: this.options.replyInThread,
          uuid: this.options.tokenService.createIdempotencyKey(),
        }),
      },
    );

    const payload = (await response.json()) as {
      code?: number;
      msg?: string;
    };

    if (!response.ok || payload.code !== 0) {
      throw new DomainError(
        `Failed to reply in Feishu: ${payload.msg ?? `HTTP ${response.status}`}`,
      );
    }

    this.options.logger.debug({ messageId }, 'Feishu reply sent');
  }

  private async sendChatTextChunk(chatId: string, text: string): Promise<void> {
    const token = await this.options.tokenService.getTenantAccessToken();
    const response = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          content: JSON.stringify({ text }),
          msg_type: 'text',
          receive_id: chatId,
          uuid: this.options.tokenService.createIdempotencyKey(),
        }),
      },
    );

    const payload = (await response.json()) as {
      code?: number;
      msg?: string;
    };

    if (!response.ok || payload.code !== 0) {
      throw new DomainError(
        `Failed to send Feishu chat message: ${payload.msg ?? `HTTP ${response.status}`}`,
      );
    }

    this.options.logger.debug({ chatId }, 'Feishu proactive message sent');
  }
}
