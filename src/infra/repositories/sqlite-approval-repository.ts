import type { Logger } from 'pino';

import type {
  ApprovalRequestRecord,
  ApprovalRiskLevel,
  ApprovalStatus,
  ApprovalRequestType,
  CreateApprovalRequestInput,
} from '../../domain/approval.js';
import type { JsonObject } from '../../domain/conversation.js';
import type {
  ApprovalRepository,
  ResolveApprovalRequestInput,
} from './approval-repository.js';
import { DatabaseClient } from '../storage/database.js';

type ApprovalRow = {
  created_at: string;
  dedupe_key: string | null;
  description: string;
  expires_at: string | null;
  id: number;
  payload_json: string | null;
  request_type: ApprovalRequestType;
  requested_by: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  risk_level: ApprovalRiskLevel;
  session_id: number | null;
  session_name: string | null;
  status: ApprovalStatus;
  title: string;
};

export class SqliteApprovalRepository implements ApprovalRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly logger: Logger,
  ) {}

  async create(input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord> {
    const row = this.database
      .prepare(
        `
        INSERT INTO approval_requests (
          session_id,
          session_name,
          request_type,
          title,
          description,
          risk_level,
          payload_json,
          status,
          requested_by,
          dedupe_key,
          expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        RETURNING *
        `,
      )
      .get(
        input.sessionId ?? null,
        input.sessionName ?? null,
        input.requestType,
        input.title,
        input.description,
        input.riskLevel,
        JSON.stringify(input.payload ?? {}),
        input.requestedBy ?? null,
        input.dedupeKey ?? null,
        input.expiresAt ?? null,
      ) as ApprovalRow;

    this.logger.debug({ approvalId: row.id, requestType: row.request_type }, 'approval created');
    return mapApprovalRow(row);
  }

  async findById(id: number): Promise<ApprovalRequestRecord | null> {
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM approval_requests
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(id) as ApprovalRow | undefined;

    return row ? mapApprovalRow(row) : null;
  }

  async findMany(
    options: {
      limit?: number;
      sessionId?: number | null;
      status?: ApprovalStatus | null;
    } = {},
  ): Promise<ApprovalRequestRecord[]> {
    const clauses: string[] = [];
    const params: Array<number | string> = [];

    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }

    if (typeof options.sessionId === 'number') {
      clauses.push('session_id = ?');
      params.push(options.sessionId);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM approval_requests
        ${whereClause}
        ORDER BY id DESC
        LIMIT ?
        `,
      )
      .all(...params, limit) as ApprovalRow[];

    return rows.map(mapApprovalRow);
  }

  async findPendingByDedupeKey(dedupeKey: string): Promise<ApprovalRequestRecord | null> {
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM approval_requests
        WHERE dedupe_key = ?
          AND status = 'pending'
        ORDER BY id DESC
        LIMIT 1
        `,
      )
      .get(dedupeKey) as ApprovalRow | undefined;

    return row ? mapApprovalRow(row) : null;
  }

  async markExecuting(id: number, resolvedBy: string): Promise<ApprovalRequestRecord | null> {
    const row = this.database
      .prepare(
        `
        UPDATE approval_requests
        SET status = 'executing',
            resolved_by = ?,
            resolution_note = NULL,
            resolved_at = NULL
        WHERE id = ?
          AND status = 'pending'
        RETURNING *
        `,
      )
      .get(resolvedBy, id) as ApprovalRow | undefined;

    if (!row) {
      this.logger.debug({ approvalId: id }, 'approval execution claim was not acquired');
      return null;
    }

    this.logger.debug({ approvalId: row.id }, 'approval execution started');
    return mapApprovalRow(row);
  }

  async resolve(input: ResolveApprovalRequestInput): Promise<ApprovalRequestRecord | null> {
    const row = this.database
      .prepare(
        `
        UPDATE approval_requests
        SET status = ?,
            resolved_by = ?,
            resolution_note = ?,
            resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = ?
        RETURNING *
        `,
      )
      .get(
        input.status,
        input.resolvedBy,
        input.resolutionNote ?? null,
        input.id,
        input.expectedStatus,
      ) as ApprovalRow | undefined;

    if (!row) {
      this.logger.debug(
        {
          approvalId: input.id,
          expectedStatus: input.expectedStatus,
          status: input.status,
        },
        'approval resolution compare-and-set did not match',
      );
      return null;
    }

    this.logger.debug({ approvalId: row.id, status: row.status }, 'approval resolved');
    return mapApprovalRow(row);
  }
}

function mapApprovalRow(row: ApprovalRow): ApprovalRequestRecord {
  return {
    createdAt: row.created_at,
    dedupeKey: row.dedupe_key,
    description: row.description,
    expiresAt: row.expires_at,
    id: row.id,
    payload: parseJsonObject(row.payload_json),
    requestType: row.request_type,
    requestedBy: row.requested_by,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    riskLevel: row.risk_level,
    sessionId: row.session_id,
    sessionName: row.session_name,
    status: row.status,
    title: row.title,
  };
}

function parseJsonObject(value: string | null): JsonObject {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}
