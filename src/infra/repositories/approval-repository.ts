import type {
  ApprovalRequestRecord,
  ApprovalStatus,
  CreateApprovalRequestInput,
} from '../../domain/approval.js';

type ApprovalResolutionMetadata = {
  id: number;
  resolutionNote?: string | null;
  resolvedBy: string;
};

export type ResolveApprovalRequestInput = ApprovalResolutionMetadata &
  (
    | {
        expectedStatus: 'executing';
        status: 'approved' | 'failed';
      }
    | {
        expectedStatus: 'pending';
        status: 'cancelled' | 'denied' | 'expired';
      }
  );

export interface ApprovalRepository {
  create(input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord>;
  findById(id: number): Promise<ApprovalRequestRecord | null>;
  findMany(options?: {
    limit?: number;
    sessionId?: number | null;
    status?: ApprovalStatus | null;
  }): Promise<ApprovalRequestRecord[]>;
  findPendingByDedupeKey(dedupeKey: string): Promise<ApprovalRequestRecord | null>;
  markExecuting(id: number, resolvedBy: string): Promise<ApprovalRequestRecord | null>;
  resolve(input: ResolveApprovalRequestInput): Promise<ApprovalRequestRecord | null>;
}
