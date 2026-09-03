import type { JsonObject } from './conversation.js';

export const APPROVAL_REQUEST_TYPES = [
  'session_stop',
  'terminal_command',
  'managed_service_action',
  'spawn',
] as const;

export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export const APPROVAL_STATUSES = [
  'pending',
  'executing',
  'approved',
  'denied',
  'failed',
  'expired',
  'cancelled',
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_RISK_LEVELS = [
  'low',
  'medium',
  'high',
] as const;

export type ApprovalRiskLevel = (typeof APPROVAL_RISK_LEVELS)[number];

export type ApprovalRequestRecord = {
  createdAt: string;
  dedupeKey: string | null;
  description: string;
  expiresAt: string | null;
  id: number;
  payload: JsonObject;
  requestType: ApprovalRequestType;
  requestedBy: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  riskLevel: ApprovalRiskLevel;
  sessionId: number | null;
  sessionName: string | null;
  status: ApprovalStatus;
  title: string;
};

export type CreateApprovalRequestInput = {
  dedupeKey?: string | null;
  description: string;
  expiresAt?: string | null;
  payload?: JsonObject;
  requestType: ApprovalRequestType;
  requestedBy?: string | null;
  riskLevel: ApprovalRiskLevel;
  sessionId?: number | null;
  sessionName?: string | null;
  title: string;
};
