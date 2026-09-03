import type { JsonObject } from './conversation.js';

export const MACHINE_STATUSES = [
  'online',
  'offline',
  'unknown',
] as const;

export type MachineStatus = (typeof MACHINE_STATUSES)[number];

export type MachineRecord = {
  capabilities: JsonObject;
  createdAt: string;
  host: string | null;
  id: number;
  labels: string[];
  lastSeenAt: string | null;
  name: string;
  namespace: string;
  runnerVersion: string | null;
  status: MachineStatus;
  updatedAt: string;
};
export type UpsertMachineInput = {
  capabilities?: JsonObject;
  host?: string | null;
  labels?: string[];
  lastSeenAt?: string | null;
  name: string;
  namespace?: string;
  runnerVersion?: string | null;
  status: MachineStatus;
};
