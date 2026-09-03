import type {
  CreateTerminalCommandInput,
  TerminalCommandRecord,
  TerminalCommandStatus,
} from '../../domain/terminal.js';

export interface TerminalCommandRepository {
  complete(input: {
    exitCode: number | null;
    id: number;
    status: Extract<TerminalCommandStatus, 'cancelled' | 'failed' | 'succeeded'>;
    stderrTail: string;
    stdoutTail: string;
  }): Promise<TerminalCommandRecord>;
  create(input: CreateTerminalCommandInput): Promise<TerminalCommandRecord>;
  findById(id: number): Promise<TerminalCommandRecord | null>;
  findBySessionId(sessionId: number, limit: number): Promise<TerminalCommandRecord[]>;
  markRunning(id: number): Promise<TerminalCommandRecord>;
  updateOutput(id: number, stdoutTail: string, stderrTail: string): Promise<TerminalCommandRecord>;
}
