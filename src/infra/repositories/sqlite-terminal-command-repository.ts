import type { Logger } from 'pino';

import type {
  CreateTerminalCommandInput,
  TerminalCommandRecord,
  TerminalCommandStatus,
} from '../../domain/terminal.js';
import type { TerminalCommandRepository } from './terminal-command-repository.js';
import { DatabaseClient } from '../storage/database.js';

type TerminalCommandRow = {
  approval_request_id: number | null;
  command: string;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  cwd: string;
  exit_code: number | null;
  id: number;
  session_id: number;
  session_name: string;
  started_at: string | null;
  status: TerminalCommandStatus;
  stderr_tail: string;
  stdout_tail: string;
};

export class SqliteTerminalCommandRepository implements TerminalCommandRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly logger: Logger,
  ) {}

  async create(input: CreateTerminalCommandInput): Promise<TerminalCommandRecord> {
    const row = this.database
      .prepare(
        `
        INSERT INTO terminal_commands (
          session_id,
          session_name,
          approval_request_id,
          command,
          cwd,
          status,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, 'queued', ?)
        RETURNING *
        `,
      )
      .get(
        input.sessionId,
        input.sessionName,
        input.approvalRequestId ?? null,
        input.command,
        input.cwd,
        input.createdBy ?? null,
      ) as TerminalCommandRow;

    this.logger.debug({ commandId: row.id }, 'terminal command created');
    return mapTerminalCommandRow(row);
  }

  async findById(id: number): Promise<TerminalCommandRecord | null> {
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM terminal_commands
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(id) as TerminalCommandRow | undefined;

    return row ? mapTerminalCommandRow(row) : null;
  }

  async findBySessionId(sessionId: number, limit: number): Promise<TerminalCommandRecord[]> {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM terminal_commands
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT ?
        `,
      )
      .all(sessionId, limit) as TerminalCommandRow[];

    return rows.map(mapTerminalCommandRow);
  }

  async markRunning(id: number): Promise<TerminalCommandRecord> {
    const row = this.database
      .prepare(
        `
        UPDATE terminal_commands
        SET status = 'running',
            started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
        WHERE id = ?
        RETURNING *
        `,
      )
      .get(id) as TerminalCommandRow;

    return mapTerminalCommandRow(row);
  }

  async updateOutput(
    id: number,
    stdoutTail: string,
    stderrTail: string,
  ): Promise<TerminalCommandRecord> {
    const row = this.database
      .prepare(
        `
        UPDATE terminal_commands
        SET stdout_tail = ?,
            stderr_tail = ?
        WHERE id = ?
        RETURNING *
        `,
      )
      .get(stdoutTail, stderrTail, id) as TerminalCommandRow;

    return mapTerminalCommandRow(row);
  }

  async complete(input: {
    exitCode: number | null;
    id: number;
    status: Extract<TerminalCommandStatus, 'cancelled' | 'failed' | 'succeeded'>;
    stderrTail: string;
    stdoutTail: string;
  }): Promise<TerminalCommandRecord> {
    const row = this.database
      .prepare(
        `
        UPDATE terminal_commands
        SET status = ?,
            exit_code = ?,
            stdout_tail = ?,
            stderr_tail = ?,
            completed_at = CURRENT_TIMESTAMP,
            started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
        WHERE id = ?
        RETURNING *
        `,
      )
      .get(
        input.status,
        input.exitCode,
        input.stdoutTail,
        input.stderrTail,
        input.id,
      ) as TerminalCommandRow;

    this.logger.debug({ commandId: row.id, status: row.status }, 'terminal command completed');
    return mapTerminalCommandRow(row);
  }
}
function mapTerminalCommandRow(row: TerminalCommandRow): TerminalCommandRecord {
  return {
    approvalRequestId: row.approval_request_id,
    command: row.command,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    cwd: row.cwd,
    exitCode: row.exit_code,
    id: row.id,
    sessionId: row.session_id,
    sessionName: row.session_name,
    startedAt: row.started_at,
    status: row.status,
    stderrTail: row.stderr_tail,
    stdoutTail: row.stdout_tail,
  };
}
