import type { ApprovalRiskLevel } from './approval.js';

export const TERMINAL_COMMAND_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type TerminalCommandStatus = (typeof TERMINAL_COMMAND_STATUSES)[number];

export type TerminalCommandRecord = {
  approvalRequestId: number | null;
  command: string;
  completedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  cwd: string;
  exitCode: number | null;
  id: number;
  sessionId: number;
  sessionName: string;
  startedAt: string | null;
  status: TerminalCommandStatus;
  stderrTail: string;
  stdoutTail: string;
};
export type CreateTerminalCommandInput = {
  approvalRequestId?: number | null;
  command: string;
  createdBy?: string | null;
  cwd: string;
  sessionId: number;
  sessionName: string;
};

export type TerminalRiskAssessment = {
  reason: string;
  requiresApproval: boolean;
  riskLevel: ApprovalRiskLevel;
};
