import type { Logger } from 'pino';

import type { SessionInspection } from '../domain/session.js';
import { ConversationService } from './conversation-service.js';
import { SessionService } from './session-service.js';

type SupervisorServiceOptions = {
  conversationService: ConversationService;
  enabled: boolean;
  intervalMs: number;
  logger: Logger;
  sessionService: SessionService;
  tailLines: number;
};

type SupervisorState = {
  enabled: boolean;
  intervalMs: number;
  isRunning: boolean;
  lastCompletedAt: string | null;
  lastStartedAt: string | null;
  latestSnapshots: SessionInspection[];
};

export class SupervisorService {
  private intervalHandle: NodeJS.Timeout | null = null;

  private readonly state: SupervisorState;

  constructor(private readonly options: SupervisorServiceOptions) {
    this.state = {
      enabled: options.enabled,
      intervalMs: options.intervalMs,
      isRunning: false,
      lastCompletedAt: null,
      lastStartedAt: null,
      latestSnapshots: [],
    };
  }

  getState(): SupervisorState {
    return {
      ...this.state,
      latestSnapshots: [...this.state.latestSnapshots],
    };
  }

  start(): void {
    if (!this.options.enabled || this.intervalHandle) {
      return;
    }

    this.options.logger.info(
      { intervalMs: this.options.intervalMs },
      'supervisor polling started',
    );

    this.intervalHandle = setInterval(() => {
      void this.runInspectionCycle();
    }, this.options.intervalMs);
  }

  stop(): void {
    if (!this.intervalHandle) {
      return;
    }

    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.options.logger.info('supervisor polling stopped');
  }

  async runInspectionCycle(): Promise<SessionInspection[]> {
    if (this.state.isRunning) {
      this.options.logger.debug('supervisor cycle skipped because one is already running');
      return this.state.latestSnapshots;
    }

    this.state.isRunning = true;
    this.state.lastStartedAt = new Date().toISOString();

    try {
      const snapshots = await this.options.sessionService.inspectAllSessions(
        this.options.tailLines,
      );
      this.state.latestSnapshots = snapshots;
      this.state.lastCompletedAt = new Date().toISOString();
      this.options.logger.info(
        {
          inspections: snapshots.map((snapshot) => ({
            name: snapshot.session.name,
            note: snapshot.note,
            observedState: snapshot.observedState,
            status: snapshot.session.status,
          })),
        },
        'supervisor cycle completed',
      );
      await this.options.conversationService.recordEvent({
        actorId: 'supervisor',
        eventType: 'supervisor.snapshot',
        payload: {
          completedAt: this.state.lastCompletedAt,
          inspections: snapshots.map((snapshot) => ({
            name: snapshot.session.name,
            note: snapshot.note,
            observedState: snapshot.observedState,
            status: snapshot.session.status,
          })),
        },
      });
      return snapshots;
    } finally {
      this.state.isRunning = false;
    }
  }
}
