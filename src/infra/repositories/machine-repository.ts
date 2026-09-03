import type { MachineRecord, UpsertMachineInput } from '../../domain/machine.js';

export interface MachineRepository {
  findAll(): Promise<MachineRecord[]>;
  findById(id: number): Promise<MachineRecord | null>;
  findByName(name: string): Promise<MachineRecord | null>;
  heartbeat(id: number, status: MachineRecord['status'], lastSeenAt: string): Promise<MachineRecord>;
  upsert(input: UpsertMachineInput): Promise<MachineRecord>;
}
