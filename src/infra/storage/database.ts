import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type { Logger } from 'pino';

export class DatabaseClient {
  private readonly database: DatabaseSync;

  constructor(
    dbPath: string,
    private readonly logger: Logger,
  ) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.database = new DatabaseSync(dbPath);
    this.database.exec('PRAGMA busy_timeout = 5000;');
    try {
      this.database.exec('PRAGMA journal_mode = WAL;');
    } catch (error) {
      this.logger.warn(
        { err: error },
        'failed to enable WAL mode during startup, continuing with default mode',
      );
    }
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(createSchema);
    for (const statement of migrationStatements) {
      try {
        this.database.exec(statement);
      } catch (error) {
        this.logger.debug(
          { err: error, statement },
          'database migration skipped or already applied',
        );
      }
    }
    this.logger.info({ dbPath }, 'database initialized');
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return this.database.prepare(sql);
  }
}

const createSchema = `
CREATE TABLE IF NOT EXISTS codex_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  agent_type TEXT NOT NULL DEFAULT 'codex',
  workspace_path TEXT NOT NULL,
  tmux_session_name TEXT NOT NULL,
  tmux_window_name TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_actor_id TEXT,
  default_for_actor INTEGER NOT NULL DEFAULT 0,
  last_output_digest TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_codex_sessions_owner_actor_id
ON codex_sessions(owner_actor_id);

CREATE TABLE IF NOT EXISTS session_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES codex_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_messages_session_id
ON session_messages(session_id, id DESC);

CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  session_name TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES codex_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id
ON session_events(session_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_session_events_event_type
ON session_events(event_type, id DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  session_name TEXT,
  request_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL,
  requested_by TEXT,
  resolved_by TEXT,
  dedupe_key TEXT,
  resolution_note TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (session_id) REFERENCES codex_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status
ON approval_requests(status, id DESC);

CREATE INDEX IF NOT EXISTS idx_approval_requests_session_id
ON approval_requests(session_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_approval_requests_dedupe_key
ON approval_requests(dedupe_key, id DESC);

CREATE TABLE IF NOT EXISTS terminal_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  session_name TEXT NOT NULL,
  approval_request_id INTEGER,
  command TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  stdout_tail TEXT NOT NULL DEFAULT '',
  stderr_tail TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES codex_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_terminal_commands_session_id
ON terminal_commands(session_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_terminal_commands_status
ON terminal_commands(status, id DESC);

CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL,
  host TEXT,
  status TEXT NOT NULL,
  labels_json TEXT,
  capabilities_json TEXT,
  runner_version TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_machines_status
ON machines(status, id DESC);
`;

const migrationStatements = [
  "ALTER TABLE codex_sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'codex';",
];
