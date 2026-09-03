import crypto from 'node:crypto';

import type { Logger } from 'pino';

import type { AppConfig } from '../../config/env.js';
import { DomainError } from '../../domain/errors.js';

type TokenCache = {
  expiresAt: number;
  token: string;
};

type TokenServiceOptions = {
  config: AppConfig;
  logger: Logger;
};

export class FeishuTokenService {
  private cache: TokenCache | null = null;

  constructor(private readonly options: TokenServiceOptions) {}

  async getTenantAccessToken(): Promise<string> {
    if (!this.options.config.feishuAppId || !this.options.config.feishuAppSecret) {
      throw new DomainError('Feishu app credentials are not configured');
    }

    const now = Date.now();

    if (this.cache && this.cache.expiresAt - now > 30_000) {
      return this.cache.token;
    }

    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          app_id: this.options.config.feishuAppId,
          app_secret: this.options.config.feishuAppSecret,
        }),
      },
    );

    if (!response.ok) {
      throw new DomainError(
        `Failed to fetch Feishu tenant_access_token: HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as {
      code?: number;
      expire?: number;
      msg?: string;
      tenant_access_token?: string;
    };

    if (payload.code !== 0 || !payload.tenant_access_token || !payload.expire) {
      throw new DomainError(
        `Failed to fetch Feishu tenant_access_token: ${payload.msg ?? 'unknown error'}`,
      );
    }

    this.cache = {
      expiresAt: now + payload.expire * 1000,
      token: payload.tenant_access_token,
    };

    this.options.logger.info('Feishu tenant_access_token refreshed');
    return this.cache.token;
  }

  createIdempotencyKey(): string {
    return crypto.randomUUID().slice(0, 36);
  }
}
