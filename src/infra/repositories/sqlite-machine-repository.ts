import type { Logger } from 'pino';

import type { JsonObject } from '../../domain/conversation.js';
import type { MachineRecord, MachineStatus, UpsertMachineInput } from '../../domain/machine.js';
import type { MachineRepository } from './machine-repository.js';
import { DatabaseClient } from '../storage/database.js';

type MachineRow = {
  capabilities_json: string | null;
  created_at: string;
  host: string | null;
  id: number;
  labels_json: string | null;
  last_seen_at: string | null;
  name: string;
  namespace: string;
  runner_version: string | null;
  status: MachineStatus;
  updated_at: string;
};

export class SqliteMachineRepository implements MachineRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly logger: Logger,
  ) {}

  async findAll(): Promise<MachineRecord[]> {
    const rows = this.database
      .prepare(
        `
        SELECT *
        FROM machines
        ORDER BY datetime(updated_at) DESC, id DESC
        `,
      )
      .all() as MachineRow[];

    return rows.map(mapMachineRow);
  }

  async findById(id: number): Promise<MachineRecord | null> {
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM machines
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(id) as MachineRow | undefined;

    return row ? mapMachineRow(row) : null;
  }

  async findByName(name: string): Promise<MachineRecord | null> {
    const row = this.database
      .prepare(
        `
        SELECT *
        FROM machines
        WHERE name = ?
        LIMIT 1
        `,
      )
      .get(name) as MachineRow | undefined;

    return row ? mapMachineRow(row) : null;
  }

  async heartbeat(
    id: number,
    status: MachineStatus,
    lastSeenAt: string,
  ): Promise<MachineRecord> {
    const row = this.database
      .prepare(
        `
        UPDATE machines
        SET status = ?,
            last_seen_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        RETURNING *
        `,
      )
      .get(status, lastSeenAt, id) as MachineRow;

    return mapMachineRow(row);
  }

  async upsert(input: UpsertMachineInput): Promise<MachineRecord> {
    const existing = await this.findByName(input.name);

    if (!existing) {
      const row = this.database
        .prepare(
          `
          INSERT INTO machines (
            name,
            namespace,
            host,
            status,
            labels_json,
            capabilities_json,
            runner_version,
            last_seen_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *
          `,
        )
        .get(
          input.name,
          input.namespace ?? 'default',
          input.host ?? null,
          input.status,
          JSON.stringify(input.labels ?? []),
          JSON.stringify(input.capabilities ?? {}),
          input.runnerVersion ?? null,
          input.lastSeenAt ?? null,
        ) as MachineRow;

      this.logger.debug({ machineId: row.id, name: row.name }, 'machine registered');
      return mapMachineRow(row);
    }

    const row = this.database
      .prepare(
        `
        UPDATE machines
        SET namespace = ?,
            host = ?,
            status = ?,
            labels_json = ?,
            capabilities_json = ?,
            runner_version = ?,
            last_seen_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        RETURNING *
        `,
      )
      .get(
        input.namespace ?? existing.namespace,
        input.host ?? existing.host ?? null,
        input.status,
        JSON.stringify(input.labels ?? existing.labels),
        JSON.stringify(input.capabilities ?? existing.capabilities),
        input.runnerVersion ?? existing.runnerVersion ?? null,
        input.lastSeenAt ?? existing.lastSeenAt ?? null,
        existing.id,
      ) as MachineRow;

    this.logger.debug({ machineId: row.id, name: row.name }, 'machine updated');
    return mapMachineRow(row);
  }
}

function mapMachineRow(row: MachineRow): MachineRecord {
  return {
    capabilities: parseJsonObject(row.capabilities_json),
    createdAt: row.created_at,
    host: row.host,
    id: row.id,
    labels: parseLabels(row.labels_json),
    lastSeenAt: row.last_seen_at,
    name: row.name,
    namespace: row.namespace,
    runnerVersion: row.runner_version,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function parseLabels(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
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
