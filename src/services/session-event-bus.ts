import type { Logger } from 'pino';

import type {
  JsonObject,
  RealtimeSessionEvent,
} from '../domain/conversation.js';

type PublishEventInput = {
  actorId?: string | null;
  eventType: string;
  payload?: JsonObject;
  sessionId?: number | null;
  sessionName?: string | null;
};

type SubscribeOptions = {
  afterId?: string | null;
};

type EventListener = (event: RealtimeSessionEvent) => void;

export class SessionEventBus {
  private nextId = 1;

  private readonly listeners = new Set<EventListener>();

  private readonly recentEvents: RealtimeSessionEvent[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly maxRecentEvents = 200,
  ) {}

  publish(input: PublishEventInput): RealtimeSessionEvent {
    const event: RealtimeSessionEvent = {
      actorId: input.actorId ?? null,
      createdAt: new Date().toISOString(),
      eventType: input.eventType,
      id: String(this.nextId),
      payload: input.payload ?? {},
      sessionId: input.sessionId ?? null,
      sessionName: input.sessionName ?? null,
    };

    this.nextId += 1;
    this.recentEvents.push(event);

    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.splice(0, this.recentEvents.length - this.maxRecentEvents);
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn({ err: error, eventType: event.eventType }, 'event listener failed');
      }
    }

    return event;
  }

  subscribe(listener: EventListener, options: SubscribeOptions = {}): () => void {
    const recentEvents = this.getEventsAfter(options.afterId ?? null);

    for (const event of recentEvents) {
      listener(event);
    }

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private getEventsAfter(afterId: string | null): RealtimeSessionEvent[] {
    if (!afterId) {
      return [];
    }

    const numericId = Number.parseInt(afterId, 10);

    if (!Number.isFinite(numericId)) {
      return [];
    }

    return this.recentEvents.filter((event) => Number.parseInt(event.id, 10) > numericId);
  }
}
