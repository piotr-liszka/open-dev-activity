import type { UserActivity } from '../types.js';

/**
 * Event types for the event bus
 */
export type EventType = 'ACTIVITY_CREATED' | 'ACTIVITIES_BATCH';

export interface ActivityCreatedEvent {
  type: 'ACTIVITY_CREATED';
  payload: UserActivity;
}

export interface ActivitiesBatchEvent {
  type: 'ACTIVITIES_BATCH';
  payload: UserActivity[];
}

export type BusEvent = ActivityCreatedEvent | ActivitiesBatchEvent;

type EventHandler<T extends BusEvent = BusEvent> = (event: T) => Promise<void> | void;

/**
 * Simple Event Bus implementation for pub/sub pattern
 */
class EventBus {
  private handlers = new Map<EventType, EventHandler[]>();

  /**
   * Subscribe to an event type
   */
  subscribe<T extends BusEvent>(eventType: T['type'], handler: EventHandler<T>): () => void {
    const handlers = this.handlers.get(eventType) || [];
    handlers.push(handler as EventHandler);
    this.handlers.set(eventType, handlers);

    // Return unsubscribe function
    return () => {
      const currentHandlers = this.handlers.get(eventType) || [];
      const index = currentHandlers.indexOf(handler as EventHandler);
      if (index > -1) {
        currentHandlers.splice(index, 1);
        this.handlers.set(eventType, currentHandlers);
      }
    };
  }

  /**
   * Publish an event to all subscribers
   */
  async publish<T extends BusEvent>(event: T): Promise<void> {
    const handlers = this.handlers.get(event.type) || [];

    // Execute all handlers (async-safe)
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          console.error(`Event handler error for ${event.type}:`, error);
        }
      })
    );
  }

  /**
   * Clear all handlers (useful for testing)
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get handler count for an event type
   */
  getHandlerCount(eventType: EventType): number {
    return (this.handlers.get(eventType) || []).length;
  }
}

// Singleton instance
export const eventBus = new EventBus();

/**
 * Helper function to emit a single activity
 */
export async function emitActivity(activity: UserActivity): Promise<void> {
  await eventBus.publish({
    type: 'ACTIVITY_CREATED',
    payload: activity,
  });
}

/**
 * Helper function to emit multiple activities as a batch
 */
export async function emitActivities(activities: UserActivity[]): Promise<void> {
  if (activities.length === 0) return;

  await eventBus.publish({
    type: 'ACTIVITIES_BATCH',
    payload: activities,
  });
}
